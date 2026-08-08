import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  ensureSpexTempGitignore,
  getRuleSkills,
  registerInstaller,
  removeDirIfEmpty,
  removeSpexTemp,
  safeRemove,
  safeWriteFile,
  type AgentInstaller,
  type InstallContext,
  type McpContext,
  type McpServerDefinition,
  type SkillSource,
  type UninstallContext,
} from './base.js';
import { getSkillDescription } from '../transformers/parse-skill.js';

const CONFIG_REL = path.join('.codex', 'config.toml');

/**
 * OpenAI Codex CLI installer。
 *
 * 路徑慣例（官方）：
 *   - 專案 skills：`.codex/skills/<name>/SKILL.md`（與 Claude Code 同為 SKILL.md 格式，啟動時掃描）
 *   - 專案指引：根目錄 `AGENTS.md`（啟動時載入；等同 Claude 的 CLAUDE.md / Copilot 的 instructions）
 *   - MCP 設定：`.codex/config.toml` 的 `[mcp_servers.<name>]`（TOML；trusted project 才讀專案層）
 *   - reference / rules：Codex 無自動載入位置，放 `.codex/reference/`、`.codex/rules/`，由 skill 執行時主動讀
 *
 * Secret 不落檔：Codex config.toml 不支援 `${VAR}` 內插。stdio 用 `env_vars = ["VAR"]`
 * 從 Codex 本機環境轉發；http 用 `bearer_token_env_var = "VAR"`。實際值仍由使用者設於 shell 環境。
 */
const codex: AgentInstaller = {
  id: 'codex',
  displayName: 'OpenAI Codex CLI',

  async detect(cwd: string): Promise<boolean> {
    const candidates = [
      path.join(cwd, '.codex'),
      path.join(cwd, 'AGENTS.md'),
      path.join(cwd, CONFIG_REL),
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
    const base = path.join(cwd, '.codex');
    return {
      skills: path.join(base, 'skills'),
      reference: path.join(base, 'reference'),
      rules: path.join(base, 'rules'),
      temp: path.join(cwd, 'spex-temp'),
      mcp: path.join(cwd, CONFIG_REL),
    };
  },

  async install(ctx: InstallContext): Promise<void> {
    const { cwd, skills, references, rules, force, log } = ctx;
    const paths = codex.paths(cwd);

    log('\n→ 安裝 Skills 到 .codex/skills/');
    for (const skill of skills) {
      const target = path.join(paths.skills, skill.name, 'SKILL.md');
      // Codex 用相同的 SKILL.md 格式；把 frontmatter 與 body 內的 .claude/ 路徑
      // 一併改寫成 .codex/（含 description 提到的輸出路徑）。
      const content = rewriteClaudePaths(matter.stringify(skill.body, skill.frontmatter));
      await safeWriteFile(target, content, { force, log });
    }

    log('\n→ 安裝 Reference 到 .codex/reference/');
    for (const ref of references) {
      const target = path.join(paths.reference, ref.relativePath);
      // reference 內文常自我引用「本安裝自身」的 .claude/ 路徑（例如 adapters/README.md 互相
      // 指涉），需同步改寫成 .codex/，否則 Codex 讀到的引用路徑會撲空。sandboxes/templates/ 下的
      // 檔案例外：那些樣板內容描述的是「生成出的 Docker 沙盒」內部結構，沙盒容器一律內建 Claude
      // Code（與 host 專案採用哪個 agent 無關），其 .claude/ 字面路徑必須保留，不能被改寫。
      const content = shouldRewriteReferenceContent(ref.relativePath)
        ? rewriteClaudePaths(ref.content)
        : ref.content;
      await safeWriteFile(target, content, { force, log });
    }

    log('\n→ 安裝 Rules 到 .codex/rules/');
    // Codex 無自動 scope（規則由 skill 執行時主動讀）。寫 rule.body（去掉 frontmatter，並把內文中
    // 引用「本安裝自身」reference/rules/skills 的 .claude/ 路徑一併改寫成 .codex/，避免 skill 依這些
    // 路徑讀檔時撲空）；若 rule 宣告了所屬 skill，以 HTML 註解標示供人參考（Codex 不會自動套用）。
    for (const rule of rules) {
      const target = path.join(paths.rules, rule.relativePath);
      const scope = formatRuleSkills(getRuleSkills(rule.frontmatter));
      const body = rewriteClaudePaths(rule.body);
      const content = scope
        ? `<!-- 所屬 skill（Codex 無自動 scope，僅供參考）: ${scope} -->\n\n${body}`
        : body;
      await safeWriteFile(target, content, { force, log });
    }

    // Codex 無原生 subagent 註冊機制，章戳鏈的 challenger / verifier 改以 `codex exec`
    // 開新對話執行——拿不到 harness 生成的章號與事件流，因此本環境**沒有可驗的章**。
    if (ctx.subagents.length > 0) {
      log(
        '\n→ Subagents：Codex 無原生 subagent 機制，未安裝 challenger / verifier 定義；' +
          '詰問以 `codex exec` 另起對話執行，且無事件流可供驗章（見 rules/sdd-workflow.md「章的強度分層」）',
      );
    }

    // 章戳硬閘（PreToolUse hook）是 Claude Code 專屬機制，Codex 無對應落點：
    // sandbox 版的 relay 驗章接線同樣依賴那條 hook 鏈，這裡一併誠實標註。
    if (ctx.mode === 'sandbox') {
      log(
        '\n→ 安裝版本 sandbox：已寫入沙盒協定與 relay 文件供參考，但 Codex 無 PreToolUse hook 機制，' +
          '無法安裝章戳硬閘；沙盒的驗章仍須由 relay 執行檔自行把關',
      );
    }

    log('\n→ 寫入 AGENTS.md');
    const agentsPath = path.join(cwd, 'AGENTS.md');
    await safeWriteFile(agentsPath, buildAgentsDoc(skills), { force, log });

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);

    log('\n→ 設定沙箱防護（.codex/config.toml 的 sandbox_mode / approval_policy）');
    await ensureCodexSandbox(cwd, log);
  },

  async configureMcp(ctx: McpContext): Promise<void> {
    const { cwd, servers, log } = ctx;
    const configPath = path.join(cwd, CONFIG_REL);

    // 讀現有 config.toml；不解析（避免引入 TOML 依賴與誤改使用者其他設定），
    // 只在缺少對應 [mcp_servers.<id>] 區塊時 append，永不覆寫既有內容。
    const existing = await fs.readFile(configPath, 'utf8').catch(() => '');

    const blocks: string[] = [];
    for (const server of servers) {
      const header = `[mcp_servers.${server.id}]`;
      if (existing.includes(header)) {
        log(`  跳過（${configPath} 已含 ${server.id}）`);
        continue;
      }
      blocks.push(renderServerToml(server));
      log(`  設定 server: ${server.id} (${server.transport})`);
    }

    if (blocks.length === 0) {
      log(`  無新增 server`);
      return;
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const banner =
      '# === spex MCP servers ===\n' +
      '# secret 一律走 shell 環境變數：stdio 用 env_vars 轉發、http 用 bearer_token_env_var。\n' +
      '# 不在本檔寫入任何明文 token。\n';
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    const output = `${existing}${prefix}${banner}\n${blocks.join('\n')}`;
    await fs.writeFile(configPath, output.endsWith('\n') ? output : output + '\n', 'utf8');
    log(`  寫入: ${configPath}`);
  },

  async uninstall(ctx: UninstallContext): Promise<void> {
    const { cwd, skills, references, rules, full, mcpServerIds, log } = ctx;
    const paths = codex.paths(cwd);

    log('\n→ 移除 Skills（.codex/skills/）');
    for (const skill of skills) {
      await safeRemove(path.join(paths.skills, skill.name), log);
    }
    await removeDirIfEmpty(paths.skills, log);

    if (references.length > 0) {
      log('\n→ 移除 Reference（.codex/reference/）');
      for (const ref of references) {
        await safeRemove(path.join(paths.reference, ref.relativePath), log);
      }
      await removeDirIfEmpty(paths.reference, log);
    }

    if (rules.length > 0) {
      log('\n→ 移除 Rules（.codex/rules/）');
      for (const rule of rules) {
        await safeRemove(path.join(paths.rules, rule.relativePath), log);
      }
      await removeDirIfEmpty(paths.rules, log);
    }

    if (!full) return;

    log('\n→ 移除 AGENTS.md');
    await safeRemove(path.join(cwd, 'AGENTS.md'), log);

    log('\n→ 移除 MCP 設定（.codex/config.toml）');
    await removeTomlMcpServers(paths.mcp, mcpServerIds, log);

    log('\n→ 移除沙箱防護（.codex/config.toml）');
    await removeCodexSandbox(paths.mcp, log);

    log('\n→ 移除 spex-temp/ 並還原 .gitignore');
    await removeSpexTemp(cwd, log);

    // 若 .codex/ 已被清空（沒有使用者其他內容）則一併移除
    await removeDirIfEmpty(path.join(cwd, '.codex'), log);
  },
};

/**
 * 從 Codex 的 config.toml 移除指定的 `[mcp_servers.<id>]` 區塊（含其子表如 `.env`）。
 * 不引入 TOML parser：以行掃描方式，從 server 標頭一路跳過到下一個「非本 server」的標頭。
 * 全部 spex server 都移除後，連同 spex 的說明 banner 一併清掉；
 * 若整檔被清空則刪除檔案，保留使用者自訂的其他設定。
 */
async function removeTomlMcpServers(
  configPath: string,
  serverIds: string[],
  log: (msg: string) => void,
): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf8').catch(() => null);
  if (raw === null) return;

  const removeSet = new Set(serverIds);
  const isHeader = (l: string) => /^\s*\[/.test(l);
  const mcpServerName = (l: string) => {
    const m = /^\s*\[mcp_servers\.([^\].]+)/.exec(l);
    return m ? m[1] : null;
  };

  const out: string[] = [];
  let skipping = false;
  let removedAny = false;
  for (const line of raw.split(/\r?\n/)) {
    if (isHeader(line)) {
      const name = mcpServerName(line);
      if (name && removeSet.has(name)) {
        if (!skipping) log(`  移除 server: ${name}`);
        skipping = true;
        removedAny = true;
        continue;
      }
      // 任何其他標頭（含不同的 mcp_servers 或頂層表）結束跳過區
      skipping = false;
    }
    if (skipping) continue;
    out.push(line);
  }

  if (!removedAny) return;

  // 若已無任何 mcp_servers 區塊，連同 spex 的 banner 註解一併移除
  const bannerLines = new Set([
    '# === spex MCP servers ===',
    '# secret 一律走 shell 環境變數：stdio 用 env_vars 轉發、http 用 bearer_token_env_var。',
    '# 不在本檔寫入任何明文 token。',
  ]);
  let result = out;
  if (!result.some((l) => /^\s*\[mcp_servers\./.test(l))) {
    result = result.filter((l) => !bannerLines.has(l.trim()));
  }

  // 收斂移除後留下的連續空行與首尾空行
  const collapsed: string[] = [];
  for (const l of result) {
    const blank = l.trim() === '';
    if (blank && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();

  const next = collapsed.length ? collapsed.join('\n') + '\n' : '';
  if (next.trim() === '') {
    await safeRemove(configPath, log);
  } else {
    await fs.writeFile(configPath, next, 'utf8');
    log(`  更新: ${configPath}`);
  }
}

/** 把 Claude Code 慣例的 .claude/ 路徑改寫成 Codex 的 .codex/（skills / reference / rules 結構鏡像）。 */
function rewriteClaudePaths(body: string): string {
  return body.replace(/\.claude\//g, '.codex/');
}

/**
 * `sandboxes/templates/` 下的 reference 檔案內容描述的是「生成出的 Docker 沙盒」內部結構——
 * 沙盒容器一律內建 Claude Code（見 `Dockerfile.tmpl` 的 `npm install -g @anthropic-ai/claude-code`），
 * 與安裝 spex 的 host 專案採用哪個 agent 無關，因此這些檔案內文的 `.claude/` 字面路徑
 * 必須保留、不能被改寫成 `.codex/`。其餘 reference 檔案（adapters、spex 範本、sandboxes
 * 協定文件本身等）內文引用的是「本安裝自身」的路徑，需要改寫。
 */
function shouldRewriteReferenceContent(relativePath: string): boolean {
  return !relativePath.startsWith('sandboxes/templates/');
}

// Codex 的 MCP-only 中層防護：以全域 sandbox 封網路 egress，擋下直打 REST 的繞過管道
// （curl / wget / az boards / gh api 都需網路，封網路即等效覆蓋 SPEX_BYPASS_COMMANDS）。
// Codex 無逐指令 denylist、無 PreToolUse hook，粒度較粗——殘餘缺口見 rules 的 MCP-only 章節。
const CODEX_SANDBOX_BANNER =
  '# === spex 沙箱防護（MCP-only 中層；封網路 egress 擋直打 REST）===';
const CODEX_SANDBOX_LINES: readonly string[] = [
  'sandbox_mode = "workspace-write"',
  'approval_policy = "untrusted"',
];

/**
 * 在 `.codex/config.toml` 頂部寫入 sandbox_mode / approval_policy（top-level key 必須在任何
 * `[table]` 之前，故 prepend）。冪等且不覆寫使用者：已存在任一鍵即略過（避免 TOML 重複鍵）。
 */
async function ensureCodexSandbox(cwd: string, log: (msg: string) => void): Promise<void> {
  const configPath = path.join(cwd, CONFIG_REL);
  const existing = await fs.readFile(configPath, 'utf8').catch(() => '');

  if (/^\s*sandbox_mode\s*=/m.test(existing) || /^\s*approval_policy\s*=/m.test(existing)) {
    log('  已存在 sandbox_mode / approval_policy，略過（不覆寫使用者設定）');
    return;
  }

  const block = `${CODEX_SANDBOX_BANNER}\n${CODEX_SANDBOX_LINES.join('\n')}\n`;
  const next = existing.length === 0 ? block : `${block}\n${existing}`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, next.endsWith('\n') ? next : next + '\n', 'utf8');
  log(`  寫入沙箱防護: ${configPath}`);
}

/**
 * 自 `.codex/config.toml` 移除 spex 的沙箱防護。
 * 只移除與 banner / CODEX_SANDBOX_LINES 完全相符的行（值被使用者改過即視為非本工具所有，不動）；
 * 收斂殘留空行，整檔清空則刪檔。
 */
async function removeCodexSandbox(configPath: string, log: (msg: string) => void): Promise<void> {
  const raw = await fs.readFile(configPath, 'utf8').catch(() => null);
  if (raw === null) return;

  const owned = new Set<string>([CODEX_SANDBOX_BANNER, ...CODEX_SANDBOX_LINES]);
  const lines = raw.split(/\r?\n/);
  if (!lines.some((l) => owned.has(l.trim()))) return;

  const kept = lines.filter((l) => !owned.has(l.trim()));

  // 收斂連續空行與首尾空行（鏡射 removeTomlMcpServers 的清理）。
  const collapsed: string[] = [];
  for (const l of kept) {
    const blank = l.trim() === '';
    if (blank && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();

  const next = collapsed.length ? collapsed.join('\n') + '\n' : '';
  if (next.trim() === '') {
    await safeRemove(configPath, log);
  } else {
    await fs.writeFile(configPath, next, 'utf8');
    log(`  已移除 spex 的沙箱防護: ${configPath}`);
  }
}

/** 把 rule 所屬的 skill 清單格式化成人類可讀字串；無有效值回傳 undefined。 */
function formatRuleSkills(skills: string[]): string | undefined {
  return skills.length > 0 ? skills.join(', ') : undefined;
}

/** 產生 AGENTS.md — Codex 啟動時載入的專案指引；skills 由 .codex/skills/ 自動發現。 */
function buildAgentsDoc(skills: SkillSource[]): string {
  const skillList = skills
    .map((s) => `- \`/${s.name}\` — ${getSkillDescription(s).split('\n')[0]}`)
    .join('\n');

  return `# AGENTS.md

此檔由 \`spex-cli\` 產生，提供 OpenAI Codex CLI 全域專案指引。

## 專案規範

- 所有註解、文件、UI 文字使用**繁體中文**；程式識別字（function / variable / type）保持英文。
- TypeScript strict mode；避免 \`any\`。
- Commit message 遵循 Conventional Commits（type(scope): description）。

## Skills

以下 spex skills 已安裝於 \`.codex/skills/\`，Codex 啟動時自動發現，可用 \`/<name>\` 觸發：

${skillList}

## 專案規則（Rules）

專案規則（adapter、驗證指令、測試 / E2E 工具、Code Conventions）位於 \`.codex/rules/\`。
skill 執行時會主動讀取對應規則檔（例如 \`.codex/rules/testing.md\` 決定測試 / E2E 工具）。
**不需要**手動把這些設定寫進本檔，安裝即生效；換工具或調整慣例只要編輯對應的規則檔。

> Codex 無 Claude Code / Copilot 的自動 scope 機制，規則一律由 skill 執行時主動讀取（runtime-read）。
> 各規則檔頂部的 HTML 註解標示了該規則「所屬的 skill」供人參考，但不會被 Codex 自動套用。

## 參考資料

SDD 治理（含核心原則、分支生命週期、架構與 File Zones、DoD、程式碼導航策略）見 \`.codex/rules/sdd-workflow.md\`；
tracker / adapter 文件見 \`.codex/reference/adapters/\`。

## MCP

若已設定 MCP（\`.codex/config.toml\`），可在 Codex 使用 azure-devops、github、stackoverflow 等工具。
機密 token 走 shell 環境變數（stdio: \`env_vars\`；http: \`bearer_token_env_var\`），不寫入專案檔案。
`;
}

/** 把單一 MCP server 定義序列化成 Codex config.toml 的 [mcp_servers.<id>] 區塊。 */
function renderServerToml(server: McpServerDefinition): string {
  const lines: string[] = [`[mcp_servers.${server.id}]`];

  if (server.transport === 'stdio') {
    lines.push(`command = ${tomlStr(server.command ?? '')}`);
    lines.push(`args = ${tomlStrArray(server.args ?? [])}`);

    // env：僅寫死的字串值（不含 ${VAR} 佔位）。
    const literalEnv: Array<[string, string]> = Object.entries(server.env ?? {}).filter(
      ([, v]) => !isPlaceholder(v),
    );
    // env_vars：需從本機環境轉發的 secret 名稱（來自 ${VAR} 佔位與 envVars 宣告）。
    const forwarded = new Set<string>();
    for (const v of Object.values(server.env ?? {})) {
      const name = placeholderName(v);
      if (name) forwarded.add(name);
    }
    for (const v of server.envVars ?? []) forwarded.add(v.name);

    if (forwarded.size > 0) {
      lines.push(`env_vars = ${tomlStrArray([...forwarded])}`);
    }
    // 子表必須放在父表所有 key 之後。
    if (literalEnv.length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${server.id}.env]`);
      for (const [k, v] of literalEnv) lines.push(`${k} = ${tomlStr(v)}`);
    }
  } else {
    lines.push(`url = ${tomlStr(server.url ?? '')}`);
    // http：把 Authorization: Bearer ${VAR} 對應成 bearer_token_env_var。
    const auth = server.headers?.Authorization ?? server.headers?.authorization;
    const bearer = auth ? placeholderName(auth.replace(/^Bearer\s+/i, '')) : undefined;
    if (bearer) lines.push(`bearer_token_env_var = ${tomlStr(bearer)}`);
  }

  return lines.join('\n') + '\n';
}

function isPlaceholder(v: string): boolean {
  return placeholderName(v) !== undefined;
}

/** 從 "${VAR}" 取出 VAR；非佔位則回傳 undefined。 */
function placeholderName(v: string): string | undefined {
  const m = /^\$\{([A-Z0-9_]+)\}$/.exec(v.trim());
  return m ? m[1] : undefined;
}

function tomlStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlStrArray(arr: string[]): string {
  return `[${arr.map(tomlStr).join(', ')}]`;
}

registerInstaller(codex);

export default codex;
