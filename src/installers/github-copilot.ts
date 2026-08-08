import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ensureSpexTempGitignore,
  registerInstaller,
  removeDirIfEmpty,
  removeJsonMcpServers,
  removeSpexTemp,
  safeRemove,
  safeWriteFile,
  SPEX_BYPASS_COMMANDS,
  SPEX_MERGE_DENY_COMMANDS,
  type AgentInstaller,
  type InstallContext,
  type McpContext,
  type UninstallContext,
} from './base.js';

/** VS Code agent 終端的繞過防護設定鍵（值為 { pattern: true } 物件）。 */
const COPILOT_DENYLIST_KEY = 'github.copilot.chat.agent.terminal.denyList';
const VSCODE_SETTINGS_REL = path.join('.vscode', 'settings.json');
import {
  toCopilotPrompt,
  toCopilotInstruction,
  buildCopilotInstructions,
} from '../transformers/to-copilot-prompt.js';

const githubCopilot: AgentInstaller = {
  id: 'github-copilot',
  displayName: 'GitHub Copilot (VS Code)',

  async detect(cwd: string): Promise<boolean> {
    const candidates = [
      path.join(cwd, '.github', 'copilot-instructions.md'),
      path.join(cwd, '.vscode', 'mcp.json'),
      path.join(cwd, '.github', 'prompts'),
    ];
    for (const p of candidates) {
      const exists = await fs
        .access(p)
        .then(() => true)
        .catch(() => false);
      if (exists) return true;
    }
    return false;
  },

  paths(cwd: string) {
    return {
      skills: path.join(cwd, '.github', 'prompts'),
      reference: path.join(cwd, '.spex', 'reference'),
      rules: path.join(cwd, '.spex', 'rules'),
      temp: path.join(cwd, 'spex-temp'),
      mcp: path.join(cwd, '.vscode', 'mcp.json'),
    };
  },

  async install(ctx: InstallContext): Promise<void> {
    const { cwd, skills, references, rules, force, log } = ctx;
    const paths = githubCopilot.paths(cwd);

    log('\n→ 安裝 Prompts 到 .github/prompts/');
    for (const skill of skills) {
      const target = path.join(paths.skills, `${skill.name}.prompt.md`);
      const content = toCopilotPrompt(skill);
      await safeWriteFile(target, content, { force, log });
    }

    log('\n→ 寫入 .github/copilot-instructions.md');
    const instructionsPath = path.join(cwd, '.github', 'copilot-instructions.md');
    const instructionsContent = buildCopilotInstructions(skills);
    await safeWriteFile(instructionsPath, instructionsContent, { force, log });

    log('\n→ 安裝 Reference 到 .spex/reference/');
    // Copilot 沒有 .claude/reference 的對應位置，放到專案根的 .spex/
    // 讓 prompt 內文以相對路徑引用
    for (const ref of references) {
      const target = path.join(paths.reference, ref.relativePath);
      await safeWriteFile(target, ref.content, { force, log });
    }

    log('\n→ 安裝 Rules 到 .spex/rules/');
    // 同 reference，Copilot 無 .claude/rules 對應位置；prompt 內文路徑由
    // toCopilotPrompt() 將 .claude/rules/ 改寫為 .spex/rules/。
    // 寫 rule.body（去掉 Claude 專屬的 paths: frontmatter），保持規則檔乾淨。
    for (const rule of rules) {
      const target = path.join(paths.rules, rule.relativePath);
      await safeWriteFile(target, rule.body, { force, log });
    }

    // path-scoped 自動套用：把 rule 的 paths: 轉成 .github/instructions/ 的 applyTo:。
    // 只有帶 paths: 的 rule 會產生指標檔；內容仍指向 .spex/rules/（單一來源）。
    log('\n→ 產生 .github/instructions/（applyTo path-scoping）');
    const instructionsDir = path.join(cwd, '.github', 'instructions');
    for (const rule of rules) {
      const instruction = toCopilotInstruction(rule);
      if (!instruction) continue;
      const fileName = rule.relativePath.replace(/\.md$/i, '.instructions.md');
      const target = path.join(instructionsDir, fileName);
      await safeWriteFile(target, instruction, { force, log });
    }

    // Copilot 無原生 subagent 機制（`.claude/agents/` 的對應物），章戳鏈的 challenger /
    // verifier 只能由使用者開新 Chat 手動扮演——無法取得 harness 生成的章號與事件流，
    // 因此本環境**沒有可驗的章**。誠實標註，不假裝安裝了等價防護。
    if (ctx.subagents.length > 0) {
      log(
        '\n→ Subagents：Copilot 無原生 subagent 機制，未安裝 challenger / verifier / code-reviewer 定義；' +
          '詰問需開新 Chat 手動執行，且無事件流可供驗章（見 rules/sdd-workflow.md「章的強度分層」）',
      );
    }

    // 章戳硬閘（PreToolUse hook）是 Claude Code 專屬機制，Copilot 無對應落點：
    // sandbox 版的 relay 驗章接線同樣依賴那條 hook 鏈，這裡一併誠實標註。
    if (ctx.mode === 'sandbox') {
      log(
        '\n→ 安裝版本 sandbox：已寫入沙盒協定與 relay 文件供參考，但 Copilot 無 PreToolUse hook 機制，' +
          '無法安裝章戳硬閘；沙盒的驗章仍須由 relay 執行檔自行把關',
      );
    }

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);

    log('\n→ 設定繞過防護與合併防護（.vscode/settings.json 的 terminal denyList）');
    await ensureCopilotDenyList(cwd, log);

    // PR 合併控管在 Claude Code 是「denyList + PreToolUse hook」兩層；Copilot 只有前者。
    // 擋不到的兩類必須誠實講出來，否則使用者會以為合併已被完整封住。
    log(
      '\n→ 合併防護（誠實標註）：Copilot 無 hook 機制，只有終端指令的字面封鎖。' +
        '擋不到 MCP 參數層的合併（update_pull_request 帶 status=completed / autoComplete），' +
        '也擋不到 git push 到保護分支——這兩類請依 rules/sdd-workflow.md「PR 合併控管」以人工紀律把關',
    );
  },

  async configureMcp(ctx: McpContext): Promise<void> {
    const { cwd, servers, log } = ctx;
    const mcpPath = path.join(cwd, '.vscode', 'mcp.json');

    let existing: { servers?: Record<string, unknown> } = {};
    const raw = await fs.readFile(mcpPath, 'utf8').catch(() => null);
    if (raw) {
      try {
        existing = JSON.parse(raw);
      } catch {
        log(`  警告：現有 ${mcpPath} 不是合法 JSON，將備份後覆寫`);
        await fs.copyFile(mcpPath, `${mcpPath}.bak`);
      }
    }

    // VS Code 格式：top-level "servers" 物件，每個 server 有 type/command/args/env 或 url
    const vsCodeServers: Record<string, unknown> = existing.servers ?? {};

    for (const server of servers) {
      if (server.transport === 'stdio') {
        // 優先採用顯式定義的 env（轉換 ${VAR} → ${env:VAR} 以符合 VS Code 慣例）
        const env: Record<string, string> = server.env
          ? Object.fromEntries(
              Object.entries(server.env).map(([k, v]) => [k, toVsCodePlaceholder(v)]),
            )
          : Object.fromEntries(
              (server.envVars ?? []).map((v) => [v.name, `\${env:${v.name}}`]),
            );
        vsCodeServers[server.id] = {
          type: 'stdio',
          command: server.command,
          args: server.args ?? [],
          ...(server.env !== undefined || Object.keys(env).length ? { env } : {}),
        };
      } else {
        vsCodeServers[server.id] = {
          type: 'http',
          url: server.url,
          ...(server.headers
            ? {
                headers: Object.fromEntries(
                  Object.entries(server.headers).map(([k, v]) => [k, toVsCodePlaceholder(v)]),
                ),
              }
            : {}),
        };
      }
      log(`  設定 server: ${server.id} (${server.transport})`);
    }

    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    const output = JSON.stringify({ ...existing, servers: vsCodeServers }, null, 2);
    await fs.writeFile(mcpPath, output + '\n', 'utf8');
    log(`  寫入: ${mcpPath}`);
  },

  async uninstall(ctx: UninstallContext): Promise<void> {
    const { cwd, skills, references, rules, full, mcpServerIds, log } = ctx;
    const paths = githubCopilot.paths(cwd);
    const instructionsDir = path.join(cwd, '.github', 'instructions');

    log('\n→ 移除 Prompts（.github/prompts/）');
    for (const skill of skills) {
      await safeRemove(path.join(paths.skills, `${skill.name}.prompt.md`), log);
    }
    await removeDirIfEmpty(paths.skills, log);

    if (references.length > 0) {
      log('\n→ 移除 Reference（.spex/reference/）');
      for (const ref of references) {
        await safeRemove(path.join(paths.reference, ref.relativePath), log);
      }
      await removeDirIfEmpty(paths.reference, log);
    }

    if (rules.length > 0) {
      log('\n→ 移除 Rules（.spex/rules/ 與 .github/instructions/）');
      for (const rule of rules) {
        await safeRemove(path.join(paths.rules, rule.relativePath), log);
        // path-scoped 指標檔（若安裝時有產生則一併移除；不存在則靜默略過）
        const instr = rule.relativePath.replace(/\.md$/i, '.instructions.md');
        await safeRemove(path.join(instructionsDir, instr), log);
      }
      await removeDirIfEmpty(paths.rules, log);
      await removeDirIfEmpty(instructionsDir, log);
    }

    if (!full) return;

    log('\n→ 移除 .github/copilot-instructions.md');
    await safeRemove(path.join(cwd, '.github', 'copilot-instructions.md'), log);

    log('\n→ 移除 MCP 設定（.vscode/mcp.json）');
    await removeJsonMcpServers(paths.mcp, 'servers', mcpServerIds, log);
    await removeDirIfEmpty(path.join(cwd, '.vscode'), log);

    log('\n→ 移除繞過防護與合併防護（.vscode/settings.json 的 terminal denyList）');
    await removeCopilotDenyList(cwd, log);
    await removeDirIfEmpty(path.join(cwd, '.vscode'), log);

    log('\n→ 移除 spex-temp/ 並還原 .gitignore');
    await removeSpexTemp(cwd, log);

    // 清掉已空的 .spex/ 與 .github/（保留使用者其他內容）
    await removeDirIfEmpty(path.join(cwd, '.spex'), log);
    await removeDirIfEmpty(path.join(cwd, '.github'), log);
  },
};

/** 把 Claude Code 風格的 ${VAR} 佔位轉成 VS Code MCP 的 ${env:VAR} */
function toVsCodePlaceholder(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, '${env:$1}');
}

/**
 * 把繞過指令家族翻成 VS Code denyList 的鍵：
 * 單字指令（curl / wget）直接用指令名；含子指令的多字（az boards / gh api）用 regex 錨定開頭，
 * 以匹配其所有子指令變體。
 */
function toCopilotDenyKey(cmd: string): string {
  return cmd.includes(' ') ? `/^${cmd.replace(/\s+/g, '\\s+')}\\b/` : cmd;
}

/**
 * spex 寫入 denyList 的鍵清單（即 uninstall 的所有權清單）：繞過指令家族 + 合併 PR 指令家族。
 * 注意 Copilot 只有這層**字面**封鎖——沒有 hook，因此擋不到 MCP 參數層的合併
 * （`update_pull_request` 帶 `status: completed`）與 `git push` 到保護分支。install 時誠實標註。
 */
const COPILOT_DENY_KEYS: readonly string[] = [
  ...SPEX_BYPASS_COMMANDS,
  ...SPEX_MERGE_DENY_COMMANDS,
].map(toCopilotDenyKey);

/**
 * 把繞過防護鍵合併進 `.vscode/settings.json` 的 denyList 物件（值為 true = 拒絕）。
 * 不可破壞 merge：保留檔內既有設定與使用者自訂的 denyList 條目；已齊全時不寫檔（冪等）；
 * 壞 JSON 先備份 .bak 後重建。Copilot 的繞過防護僅 VS Code agent 終端生效（殘餘缺口見 rules）。
 */
async function ensureCopilotDenyList(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, VSCODE_SETTINGS_REL);

  let settings: Record<string, unknown> = {};
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (raw) {
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      log(`  警告：現有 ${settingsPath} 不是合法 JSON，將備份後重建`);
      await fs.copyFile(settingsPath, `${settingsPath}.bak`);
      settings = {};
    }
  }

  const existing = settings[COPILOT_DENYLIST_KEY];
  const denyList: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const missing = COPILOT_DENY_KEYS.filter((key) => denyList[key] !== true);

  if (missing.length === 0 && typeof existing === 'object' && existing !== null) {
    log('  繞過防護與合併防護已齊全（denyList），不需變更');
    return;
  }

  for (const key of missing) denyList[key] = true;
  settings[COPILOT_DENYLIST_KEY] = denyList;
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  for (const key of missing) log(`  加入 denyList: ${key}`);
  log(`  寫入: ${settingsPath}`);
}

/**
 * 自 `.vscode/settings.json` 移除 spex 的繞過防護鍵。
 * 只移除 COPILOT_DENY_KEYS 且值仍為 true 的條目；使用者自訂條目與其他設定保留。
 * 清空後的空結構逐層移除，整檔變空物件時直接刪檔。
 */
async function removeCopilotDenyList(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, VSCODE_SETTINGS_REL);
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (!raw) return;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log(`  警告：${settingsPath} 不是合法 JSON，略過繞過防護清理`);
    return;
  }

  const existing = settings[COPILOT_DENYLIST_KEY];
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) return;
  const denyList = existing as Record<string, unknown>;

  let removed = 0;
  for (const key of COPILOT_DENY_KEYS) {
    if (denyList[key] === true) {
      delete denyList[key];
      removed++;
    }
  }
  if (removed === 0) return;

  if (Object.keys(denyList).length === 0) {
    delete settings[COPILOT_DENYLIST_KEY];
  } else {
    settings[COPILOT_DENYLIST_KEY] = denyList;
  }

  if (Object.keys(settings).length === 0) {
    await safeRemove(settingsPath, log);
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  已移除 spex 的繞過防護: ${settingsPath}`);
}

registerInstaller(githubCopilot);

export default githubCopilot;
