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
  type HookSource,
  type InstallContext,
  type McpContext,
  type McpServerDefinition,
  type SkillSource,
  type SubagentSource,
  type UninstallContext,
} from './base.js';
import { getSkillDescription } from '../transformers/parse-skill.js';

const CONFIG_REL = path.join('.codex', 'config.toml');
const AGENTS_REL = path.join('.codex', 'agents');
const HOOKS_REL = path.join('.codex', 'hooks');
const HOOKS_JSON_REL = path.join('.codex', 'hooks.json');

/** 編輯期 hook 掛在 `PostToolUse`：檔案已經寫完才輪到 lint 與格式化。 */
const HOOK_EVENT = 'PostToolUse';
const HOOK_MATCHER = 'Edit|Write|MultiEdit';

/**
 * Codex 無 `$CLAUDE_PROJECT_DIR`，以 git 根目錄定位 hook 腳本。
 * 以 `bash <path>` 呼叫而非直接執行：腳本透過 safeWriteFile 寫入、不帶執行位元。
 */
const hookCommand = (fileName: string): string =>
  `bash "$(git rev-parse --show-toplevel)/.codex/hooks/${fileName}"`;

/** 只有可執行的 hook 腳本要掛進 hooks.json；`.env` 是它們讀的設定檔。 */
const executableHooks = (hooks: HookSource[]): HookSource[] =>
  hooks.filter((h) => !h.isConfig);

/**
 * OpenAI Codex CLI installer。
 *
 * 路徑慣例（官方）：
 *   - 專案 skills：`.codex/skills/<name>/SKILL.md`（與 Claude Code 同為 SKILL.md 格式，啟動時掃描）
 *   - 專案指引：根目錄 `AGENTS.md`（啟動時載入；等同 Claude 的 CLAUDE.md / Copilot 的 instructions）
 *   - MCP 設定：`.codex/config.toml` 的 `[mcp_servers.<name>]`（TOML；trusted project 才讀專案層）
 *   - reference / rules：Codex 無自動載入位置，放 `.codex/reference/`、`.codex/rules/`，由 skill 執行時主動讀
 *   - 子代理：`.codex/agents/<name>.toml`（TOML；`developer_instructions` 帶指示原文）
 *   - hooks：`.codex/hooks.json` 指定事件與指令，腳本放 `.codex/hooks/`
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
      agents: path.join(cwd, AGENTS_REL),
      hooks: path.join(cwd, HOOKS_REL),
      temp: path.join(cwd, 'spex-temp'),
      mcp: path.join(cwd, CONFIG_REL),
    };
  },

  async install(ctx: InstallContext): Promise<void> {
    const { cwd, skills, references, rules, subagents, hooks, force, log } = ctx;
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
      // 指涉），需同步改寫成 .codex/，否則 Codex 讀到的引用路徑會撲空。
      await safeWriteFile(target, rewriteClaudePaths(ref.content), { force, log });
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

    log('\n→ 安裝 Subagents 到 .codex/agents/');
    // code-reviewer 與 verifier 必須是註冊過的子代理才派得出去；
    // 缺定義 = spex-selfcheck 的整體 review 與獨立驗收無法執行。
    for (const agent of subagents) {
      const target = path.join(cwd, AGENTS_REL, subagentTomlName(agent));
      await safeWriteFile(target, renderSubagentToml(agent), { force, log });
    }

    log('\n→ 安裝編輯期 hook 到 .codex/hooks/');
    for (const hook of hooks) {
      const target = path.join(cwd, HOOKS_REL, hook.relativePath);
      // 設定檔裝的是使用者填的專案指令，即使帶 --force 也不覆寫。
      await safeWriteFile(target, hook.content, {
        force: hook.isConfig ? false : force,
        log,
      });
    }

    log(`\n→ 設定編輯期 hook（.codex/hooks.json 的 ${HOOK_EVENT}）`);
    for (const hook of executableHooks(hooks)) {
      await ensureSpexHook(cwd, hookCommand(hook.relativePath), log);
    }

    log('\n→ 寫入 AGENTS.md');
    const agentsDocPath = path.join(cwd, 'AGENTS.md');
    await safeWriteFile(agentsDocPath, buildAgentsDoc(skills), { force, log });

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);
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
    const { cwd, skills, references, rules, subagents, hooks, full, mcpServerIds, log } = ctx;
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

    if (subagents.length > 0) {
      log('\n→ 移除 Subagents（.codex/agents/）');
      for (const agent of subagents) {
        await safeRemove(path.join(cwd, AGENTS_REL, subagentTomlName(agent)), log);
      }
      await removeDirIfEmpty(path.join(cwd, AGENTS_REL), log);
    }

    if (hooks.length > 0) {
      log('\n→ 移除編輯期 hook（.codex/hooks/）');
      for (const hook of hooks) {
        await safeRemove(path.join(cwd, HOOKS_REL, hook.relativePath), log);
      }
      await removeDirIfEmpty(path.join(cwd, HOOKS_REL), log);

      log('\n→ 移除 hook 條目（.codex/hooks.json）');
      await removeSpexHooks(
        cwd,
        executableHooks(hooks).map((h) => hookCommand(h.relativePath)),
        log,
      );
    }

    if (!full) return;

    log('\n→ 移除 AGENTS.md');
    await safeRemove(path.join(cwd, 'AGENTS.md'), log);

    log('\n→ 移除 MCP 設定（.codex/config.toml）');
    await removeTomlMcpServers(paths.mcp, mcpServerIds, log);

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

/** 子代理定義的落地檔名：`<name>.toml`。 */
function subagentTomlName(agent: SubagentSource): string {
  return `${agent.name}.toml`;
}

/**
 * 把 markdown 子代理定義轉成 Codex 的 agent TOML。
 * frontmatter 的 name / description 成為 TOML 欄位，body 進 `developer_instructions`；
 * body 內引用「本安裝自身」的 .claude/ 路徑一併改寫成 .codex/。
 * 審查與驗收都必須唯讀，故一律宣告 `sandbox_mode = "read-only"`。
 */
function renderSubagentToml(agent: SubagentSource): string {
  const parsed = matter(agent.content);
  const description =
    typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
  const instructions = rewriteClaudePaths(parsed.content).trim();

  const lines = [`name = ${tomlStr(agent.name)}`];
  if (description) lines.push(`description = ${tomlStr(description)}`);
  lines.push('sandbox_mode = "read-only"');
  lines.push(`developer_instructions = ${tomlMultiline(instructions)}`);
  return lines.join('\n') + '\n';
}

interface HookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}
interface CodexHooksFile {
  hooks?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * 把一支 hook 合併進 `.codex/hooks.json` 的對應事件陣列。
 * 不可破壞 merge：保留使用者既有的其他 hook 條目與其 matcher；已存在同一 command 即冪等返回。
 */
async function ensureSpexHook(
  cwd: string,
  command: string,
  log: (msg: string) => void,
): Promise<void> {
  const hooksPath = path.join(cwd, HOOKS_JSON_REL);

  let config: CodexHooksFile = {};
  const raw = await fs.readFile(hooksPath, 'utf8').catch(() => null);
  if (raw) {
    try {
      config = JSON.parse(raw) as CodexHooksFile;
    } catch {
      log(`  警告：現有 ${hooksPath} 不是合法 JSON，將備份後重建`);
      await fs.copyFile(hooksPath, `${hooksPath}.bak`);
      config = {};
    }
  }

  if (typeof config.hooks !== 'object' || config.hooks === null || Array.isArray(config.hooks)) {
    config.hooks = {};
  }
  const hooks = config.hooks;
  const entries = Array.isArray(hooks[HOOK_EVENT]) ? (hooks[HOOK_EVENT] as HookMatcher[]) : [];

  if (entries.some((e) => (e?.hooks ?? []).some((h) => h?.command === command))) {
    log(`  hook 已存在，不需變更: ${command}`);
    return;
  }

  hooks[HOOK_EVENT] = [
    ...entries,
    {
      matcher: HOOK_MATCHER,
      hooks: [{ type: 'command', command }],
    },
  ];
  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  log(`  加入 ${HOOK_EVENT} hook: ${command}`);
  log(`  寫入: ${hooksPath}`);
}

/**
 * 自 `.codex/hooks.json` 移除 spex 的 hook 條目。
 * 只移除 command 落在所有權清單內的項目；使用者自訂 hook 一律保留。
 * 清空後的空結構逐層移除，整檔變空物件時直接刪檔。
 */
async function removeSpexHooks(
  cwd: string,
  owned: readonly string[],
  log: (msg: string) => void,
): Promise<void> {
  const hooksPath = path.join(cwd, HOOKS_JSON_REL);
  const raw = await fs.readFile(hooksPath, 'utf8').catch(() => null);
  if (!raw) return;

  let config: CodexHooksFile;
  try {
    config = JSON.parse(raw) as CodexHooksFile;
  } catch {
    log(`  警告：${hooksPath} 不是合法 JSON，略過 hook 清理`);
    return;
  }

  const hooks = config.hooks;
  if (typeof hooks !== 'object' || hooks === null || !Array.isArray(hooks[HOOK_EVENT])) return;

  const original = hooks[HOOK_EVENT] as HookMatcher[];
  const kept = original
    .map((entry) => {
      const inner = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const keptInner = inner.filter(
        (h) => !(typeof h?.command === 'string' && owned.includes(h.command)),
      );
      return keptInner.length === inner.length ? entry : { ...entry, hooks: keptInner };
    })
    .filter((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.length > 0 : true));

  if (JSON.stringify(kept) === JSON.stringify(original)) return;

  if (kept.length > 0) {
    hooks[HOOK_EVENT] = kept;
  } else {
    delete hooks[HOOK_EVENT];
  }
  if (Object.keys(hooks).length === 0) {
    delete config.hooks;
  }

  if (Object.keys(config).length === 0) {
    await safeRemove(hooksPath, log);
    return;
  }
  await fs.writeFile(hooksPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  log(`  已移除 spex 的 ${HOOK_EVENT} hook: ${hooksPath}`);
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

## 子代理（Subagents）

\`.codex/agents/\` 下的 \`code-reviewer\` 與 \`verifier\` 是唯讀子代理定義：
Epic 全部 Story 實作就緒後由 \`spex-selfcheck\` 派一次整體 review，機器驗證全綠後再派一次獨立驗收。

## 編輯期 hook

\`.codex/hooks.json\` 掛了兩支 \`PostToolUse\` hook：異動檔案後對「剛異動的那一個檔」跑 lint 與格式化。
指令寫在 \`.codex/hooks/spex-hooks.env\`，留空即停用該支 hook。

## 參考資料

SDD 治理（含核心原則、分支生命週期、Epic 驗收與整合、DoD、程式碼導航策略）見 \`.codex/rules/sdd-workflow.md\`；
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

/**
 * TOML multi-line basic string。反斜線是轉義字元須加倍；內容裡的三連引號會提前收尾，
 * 故轉義其首字元。結尾若剛好是引號也一併轉義，避免與收尾符號連成四個。
 * 開頭換行由 TOML 規範自動吃掉，正好讓內容從下一行開始。
 */
function tomlMultiline(v: string): string {
  const escaped = v.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
  const tail = escaped.endsWith('"') ? `${escaped.slice(0, -1)}\\"` : escaped;
  return `"""\n${tail}\n"""`;
}

registerInstaller(codex);

export default codex;
