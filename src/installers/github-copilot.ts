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
  type AgentInstaller,
  type InstallContext,
  type McpContext,
  type UninstallContext,
} from './base.js';

/** VS Code agent 終端的繞過防護設定鍵（值為 { pattern: true } 物件）。 */
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

    // Copilot 無原生子代理機制，也無 hook 落點。誠實標註，不假裝安裝了等價能力。
    if (ctx.subagents.length > 0) {
      log(
        '\n→ Subagents：Copilot 無原生子代理機制，未安裝 code-reviewer / verifier 定義；' +
          'spex-selfcheck 的整體 review 與獨立驗收需開新 Chat 依該定義手動執行',
      );
    }

    if (ctx.hooks.length > 0) {
      log(
        '\n→ 編輯期 hook：Copilot 無 hook 機制，未安裝 lint / format hook；' +
          '請依 rules/commands.md 的驗證指令束自行執行',
      );
    }

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);
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

registerInstaller(githubCopilot);

export default githubCopilot;
