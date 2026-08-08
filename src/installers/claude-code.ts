import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  ensureSpexTempGitignore,
  getRuleSkills,
  registerInstaller,
  removeDirIfEmpty,
  removeJsonMcpServers,
  removeSpexTemp,
  safeRemove,
  safeWriteFile,
  SPEX_BYPASS_COMMANDS,
  type AgentInstaller,
  type InstallContext,
  type InstallMode,
  type McpContext,
  type RuleSource,
  type UninstallContext,
} from './base.js';

const AGENTS_REL = path.join('.claude', 'agents');
const SETTINGS_REL = path.join('.claude', 'settings.local.json');
const SETTINGS_JSON_REL = path.join('.claude', 'settings.json');
const MCP_REL = '.mcp.json';

/**
 * spex 管理的 PR 開立防護規則（permissions.ask）。
 * 把所有「開 PR」管道設為 ask：互動 session 必須由使用者當下核准，
 * headless / 自動化模式會被直接拒絕——這是 goal「禁止 AI 自動開 PR」的技術層防線。
 * 此常數同時是 uninstall 的所有權清單：只有與此處字串完全相符的規則會被移除，
 * 使用者自行加入的其他規則一律保留。
 */
const SPEX_PR_ASK_RULES: readonly string[] = [
  'mcp__azure-devops__create_pull_request',
  'Bash(az repos pr create:*)',
  'Bash(gh pr create:*)',
];

/**
 * 把 SPEX_BYPASS_COMMANDS 翻譯成 Claude Code `permissions.deny` 的規則字串
 * （`Bash(<cmd>:*)`）。deny 在 Claude Code 由 harness 而非模型強制，優先序高於 ask/allow，
 * 讓繞過 MCP/TRACKER 的直打 CLI 在權限層被擋。此衍生清單即 deny 的所有權清單。
 */
const SPEX_BYPASS_DENY_RULES: readonly string[] = SPEX_BYPASS_COMMANDS.map(
  (cmd) => `Bash(${cmd}:*)`,
);

/**
 * 章戳硬閘 hook（PreToolUse，exit 2）。這是由 harness 而非模型強制的環節：
 * 含章戳宣稱的 tracker 寫入未過驗章一律拒發，且事件流（`~/.claude/projects/`，章的載體）
 * 不得被 Write / Edit / Bash 改寫。
 *
 * 命令帶 `--plane` 參數標明本安裝屬於哪個平面——章戳鏈有兩個平面、兩種章源，
 * hook 只在自己的平面有裁定權：
 * - `--plane agent`：章在本 session 事件流 → 本 hook 跑 challenge-audit 裁定。
 * - `--plane sandbox`：章在 host 影子流、由 relay 執行檔裁定 → 本 hook 不驗 transcript
 *   （驗了必然找不到 challenger 派發事件而產生假 FAIL），改為擋下 host 直發的含章留言。
 */
// 以 `bash <path>` 呼叫而非直接執行：reference 檔案透過 safeWriteFile 寫入、不帶執行位元，
// 直接執行會因權限失敗而讓整條硬閘靜默失效。
const SPEX_STAMP_HOOK_BASE =
  'bash "$CLAUDE_PROJECT_DIR/.claude/reference/spex/scripts/spex-stamp-guard.sh"';
const SPEX_STAMP_HOOK_COMMANDS: Record<InstallMode, string> = {
  agent: `${SPEX_STAMP_HOOK_BASE} --plane agent`,
  sandbox: `${SPEX_STAMP_HOOK_BASE} --plane sandbox`,
};
/**
 * 章戳硬閘的所有權清單（uninstall 與「換模式時就地替換」的判定依據）。
 * 含 v0.7.0 的無參數舊字串，讓升級／切換模式時是**替換同一條目**而非重複附加——
 * 兩支平面不同的硬閘同時掛著會互相矛盾（其中一支必定誤判）。
 */
const SPEX_STAMP_HOOK_OWNED: readonly string[] = [
  SPEX_STAMP_HOOK_COMMANDS.agent,
  SPEX_STAMP_HOOK_COMMANDS.sandbox,
  SPEX_STAMP_HOOK_BASE,
];
const SPEX_STAMP_HOOK_MATCHER = 'Write|Edit|MultiEdit|Bash|mcp__.*';

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
interface ClaudeSettingsFile {
  permissions?: { ask?: unknown; deny?: unknown; [k: string]: unknown };
  hooks?: { PreToolUse?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

const claudeCode: AgentInstaller = {
  id: 'claude-code',
  displayName: 'Claude Code',

  async detect(cwd: string): Promise<boolean> {
    const candidates = [
      path.join(cwd, '.claude'),
      path.join(cwd, 'CLAUDE.md'),
      path.join(cwd, SETTINGS_REL),
      path.join(cwd, SETTINGS_JSON_REL),
      path.join(cwd, MCP_REL),
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
    const base = path.join(cwd, '.claude');
    return {
      skills: path.join(base, 'skills'),
      reference: path.join(base, 'reference'),
      rules: path.join(base, 'rules'),
      agents: path.join(cwd, AGENTS_REL),
      temp: path.join(cwd, 'spex-temp'),
      mcp: path.join(cwd, MCP_REL),
    };
  },

  async install(ctx: InstallContext): Promise<void> {
    const { cwd, mode, skills, references, rules, subagents, force, log } = ctx;
    const paths = claudeCode.paths(cwd);

    log('\n→ 安裝 Skills 到 .claude/skills/');
    for (const skill of skills) {
      const target = path.join(paths.skills, skill.name, 'SKILL.md');
      const content = matter.stringify(skill.body, skill.frontmatter);
      await safeWriteFile(target, content, { force, log });
    }

    log('\n→ 安裝 Reference 到 .claude/reference/');
    for (const ref of references) {
      const target = path.join(paths.reference, ref.relativePath);
      await safeWriteFile(target, ref.content, { force, log });
    }

    log('\n→ 安裝 Rules 到 .claude/rules/');
    // 把 rule 的 skills: 宣告轉成 Claude Code 原生的 paths: 條件式載入，glob 指向各 skill
    // 的 SKILL.md。如此規則只在那些 skill 的脈絡相關，不會在使用者讀一般原始碼時被自動載入。
    for (const rule of rules) {
      const target = path.join(paths.rules, rule.relativePath);
      await safeWriteFile(target, renderRuleForClaude(rule), { force, log });
    }

    log('\n→ 安裝 Subagents 到 .claude/agents/');
    // 章戳鏈的 challenger / verifier 必須是註冊過的 subagent_type 才派得出去；
    // 缺定義 = spex-challenge / spex-selfcheck 的獨立詰問與驗收無法執行。
    for (const agent of subagents) {
      const target = path.join(cwd, AGENTS_REL, agent.relativePath);
      await safeWriteFile(target, agent.content, { force, log });
    }

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);

    log('\n→ 設定 PR 開立防護（.claude/settings.json 的 permissions.ask）');
    await ensurePrAskPermissions(cwd, log);

    log('\n→ 設定繞過防護（.claude/settings.json 的 permissions.deny）');
    await ensureBypassDeny(cwd, log);

    log(`\n→ 設定章戳硬閘（.claude/settings.json 的 PreToolUse hook，--plane ${mode}）`);
    await ensureStampGuardHook(cwd, mode, log);
  },

  async configureMcp(ctx: McpContext): Promise<void> {
    const { cwd, servers, log } = ctx;
    const mcpPath = path.join(cwd, MCP_REL);

    // 讀取現有 .mcp.json，保留使用者其他自訂 server
    // 注意：MCP server 設定必須放在專案根目錄的 .mcp.json，
    // Claude Code 不會從 .claude/settings.local.json 讀取 mcpServers。
    let existing: { mcpServers?: Record<string, unknown>; [k: string]: unknown } = {};
    const raw = await fs.readFile(mcpPath, 'utf8').catch(() => null);
    if (raw) {
      try {
        existing = JSON.parse(raw);
      } catch {
        log(`  警告：現有 ${mcpPath} 不是合法 JSON，將備份後覆寫`);
        await fs.copyFile(mcpPath, `${mcpPath}.bak`);
      }
    }

    const mcpServers: Record<string, unknown> = (existing.mcpServers as Record<string, unknown>) ?? {};

    for (const server of servers) {
      if (server.transport === 'stdio') {
        // 優先採用顯式定義的 env（保留鍵順序與寫死值），否則從 envVars 推導 ${VAR} 佔位。
        // 機密值（PAT 等）一律以 ${VAR} 寫入，實際值由使用者在 ~/.zshrc 設環境變數提供。
        const env: Record<string, string> = server.env
          ? { ...server.env }
          : Object.fromEntries((server.envVars ?? []).map((v) => [v.name, `\${${v.name}}`]));
        mcpServers[server.id] = {
          type: 'stdio',
          command: server.command,
          args: server.args ?? [],
          ...(server.env !== undefined || Object.keys(env).length ? { env } : {}),
        };
      } else {
        mcpServers[server.id] = {
          type: 'http',
          url: server.url,
          ...(server.headers ? { headers: { ...server.headers } } : {}),
        };
      }
      log(`  設定 server: ${server.id} (${server.transport})`);
    }

    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    const output = JSON.stringify({ ...existing, mcpServers }, null, 2);
    await fs.writeFile(mcpPath, output + '\n', 'utf8');
    log(`  寫入: ${mcpPath}`);

    // .mcp.json 只含 ${VAR} 佔位，可進版控供團隊共享。
    // 機密 token 一律走 shell 環境（~/.zshrc / CI Secret），不在專案內建立任何 dotenv 檔。
  },

  async uninstall(ctx: UninstallContext): Promise<void> {
    const { cwd, skills, references, rules, subagents, full, mcpServerIds, log } = ctx;
    const paths = claudeCode.paths(cwd);

    log('\n→ 移除 Skills（.claude/skills/）');
    for (const skill of skills) {
      await safeRemove(path.join(paths.skills, skill.name), log);
    }
    await removeDirIfEmpty(paths.skills, log);

    if (references.length > 0) {
      log('\n→ 移除 Reference（.claude/reference/）');
      for (const ref of references) {
        await safeRemove(path.join(paths.reference, ref.relativePath), log);
      }
      await removeDirIfEmpty(paths.reference, log);
    }

    if (rules.length > 0) {
      log('\n→ 移除 Rules（.claude/rules/）');
      for (const rule of rules) {
        await safeRemove(path.join(paths.rules, rule.relativePath), log);
      }
      await removeDirIfEmpty(paths.rules, log);
    }

    if (subagents.length > 0) {
      log('\n→ 移除 Subagents（.claude/agents/）');
      // 只移除 spex 自帶的定義檔，使用者自訂的 agent 一律保留
      for (const agent of subagents) {
        await safeRemove(path.join(cwd, AGENTS_REL, agent.relativePath), log);
      }
      await removeDirIfEmpty(path.join(cwd, AGENTS_REL), log);
    }

    if (!full) return;

    log('\n→ 移除 MCP 設定（.mcp.json）');
    await removeJsonMcpServers(paths.mcp, 'mcpServers', mcpServerIds, log);

    log('\n→ 移除 spex-temp/ 並還原 .gitignore');
    await removeSpexTemp(cwd, log);

    log('\n→ 移除 PR 開立防護（.claude/settings.json）');
    await removePrAskPermissions(cwd, log);

    log('\n→ 移除繞過防護（.claude/settings.json）');
    await removeBypassDeny(cwd, log);

    log('\n→ 移除章戳硬閘 hook（.claude/settings.json）');
    await removeStampGuardHook(cwd, log);

    // 若 .claude/ 已被清空（沒有使用者其他內容）則一併移除
    await removeDirIfEmpty(path.join(cwd, '.claude'), log);
  },
};

/**
 * 把 SPEX_PR_ASK_RULES 合併進專案 `.claude/settings.json` 的 permissions.ask。
 * 不可破壞 merge：保留檔內既有設定與使用者自訂規則；三條規則已齊全時不寫檔（冪等）。
 * 寫入專案層 settings.json（而非 settings.local.json）讓防護可進版控、約束整個團隊。
 */
async function ensurePrAskPermissions(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);

  let settings: ClaudeSettingsFile = {};
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (raw) {
    try {
      settings = JSON.parse(raw) as ClaudeSettingsFile;
    } catch {
      log(`  警告：現有 ${settingsPath} 不是合法 JSON，將備份後重建`);
      await fs.copyFile(settingsPath, `${settingsPath}.bak`);
      settings = {};
    }
  }

  if (typeof settings.permissions !== 'object' || settings.permissions === null || Array.isArray(settings.permissions)) {
    settings.permissions = {};
  }
  const permissions = settings.permissions;
  const ask = Array.isArray(permissions.ask) ? (permissions.ask as unknown[]) : [];
  const missing = SPEX_PR_ASK_RULES.filter((rule) => !ask.includes(rule));

  if (missing.length === 0 && Array.isArray(permissions.ask)) {
    log('  PR 防護規則已齊全（permissions.ask），不需變更');
    return;
  }

  permissions.ask = [...ask, ...missing];
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  for (const rule of missing) log(`  加入 ask 規則: ${rule}`);
  log(`  寫入: ${settingsPath}`);
}

/**
 * 自 `.claude/settings.json` 移除 spex 的 PR 防護規則。
 * 只移除與 SPEX_PR_ASK_RULES 完全相符的字串；使用者自訂規則與其他鍵保留。
 * 清空後的空結構逐層移除，整檔變空物件時直接刪檔。
 */
async function removePrAskPermissions(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (!raw) return;

  let settings: ClaudeSettingsFile;
  try {
    settings = JSON.parse(raw) as ClaudeSettingsFile;
  } catch {
    log(`  警告：${settingsPath} 不是合法 JSON，略過 PR 防護規則清理`);
    return;
  }

  const permissions = settings.permissions;
  if (typeof permissions !== 'object' || permissions === null || !Array.isArray(permissions.ask)) return;

  const original = permissions.ask as unknown[];
  const kept = original.filter((rule) => !(typeof rule === 'string' && SPEX_PR_ASK_RULES.includes(rule)));
  if (kept.length === original.length) return;

  if (kept.length > 0) {
    permissions.ask = kept;
  } else {
    delete permissions.ask;
  }
  if (Object.keys(permissions).length === 0) {
    delete settings.permissions;
  }

  if (Object.keys(settings).length === 0) {
    await safeRemove(settingsPath, log);
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  已移除 spex 的 PR 防護規則: ${settingsPath}`);
}

/**
 * 把 SPEX_BYPASS_DENY_RULES 合併進專案 `.claude/settings.json` 的 permissions.deny。
 * 鏡射 ensurePrAskPermissions 的不可破壞 merge／冪等／壞 JSON 備份 .bak 邏輯，只是目標
 * 改為 deny。寫入專案層 settings.json 讓繞過防護可進版控、約束整個團隊。
 */
async function ensureBypassDeny(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);

  let settings: ClaudeSettingsFile = {};
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (raw) {
    try {
      settings = JSON.parse(raw) as ClaudeSettingsFile;
    } catch {
      log(`  警告：現有 ${settingsPath} 不是合法 JSON，將備份後重建`);
      await fs.copyFile(settingsPath, `${settingsPath}.bak`);
      settings = {};
    }
  }

  if (typeof settings.permissions !== 'object' || settings.permissions === null || Array.isArray(settings.permissions)) {
    settings.permissions = {};
  }
  const permissions = settings.permissions;
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as unknown[]) : [];
  const missing = SPEX_BYPASS_DENY_RULES.filter((rule) => !deny.includes(rule));

  if (missing.length === 0 && Array.isArray(permissions.deny)) {
    log('  繞過防護規則已齊全（permissions.deny），不需變更');
    return;
  }

  permissions.deny = [...deny, ...missing];
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  for (const rule of missing) log(`  加入 deny 規則: ${rule}`);
  log(`  寫入: ${settingsPath}`);
}

/**
 * 把章戳硬閘 hook 合併進專案 `.claude/settings.json` 的 `hooks.PreToolUse`。
 * 不可破壞 merge：保留使用者既有的其他 hook 條目。三態：
 *   1. 已存在**目標平面**的 command → 不寫檔（冪等）。
 *   2. 已存在其他 owned 變體（換模式、或從 v0.7.0 無參數字串升級）→ **就地替換** command，
 *      不新增條目——兩支平面不同的硬閘同時掛著必有一支誤判。
 *   3. 都沒有 → append 新條目。
 * 只認 command 字串做所有權判定，matcher 被使用者調整過也不覆寫（那是有意識的調整）。
 */
async function ensureStampGuardHook(
  cwd: string,
  mode: InstallMode,
  log: (msg: string) => void,
): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);
  const desired = SPEX_STAMP_HOOK_COMMANDS[mode];

  let settings: ClaudeSettingsFile = {};
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (raw) {
    try {
      settings = JSON.parse(raw) as ClaudeSettingsFile;
    } catch {
      log(`  警告：現有 ${settingsPath} 不是合法 JSON，將備份後重建`);
      await fs.copyFile(settingsPath, `${settingsPath}.bak`);
      settings = {};
    }
  }

  if (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  const hooks = settings.hooks;
  const preToolUse = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as HookMatcher[]) : [];

  const owned = (cmd: unknown): cmd is string =>
    typeof cmd === 'string' && SPEX_STAMP_HOOK_OWNED.includes(cmd);

  if (preToolUse.some((e) => (e?.hooks ?? []).some((h) => h?.command === desired))) {
    log(`  章戳硬閘 hook 已存在（--plane ${mode}），不需變更`);
    return;
  }

  const hasOther = preToolUse.some((e) => (e?.hooks ?? []).some((h) => owned(h?.command)));
  if (hasOther) {
    // 換平面：把既有的 spex 條目就地改成目標平面，保留使用者調整過的 matcher 與同條目內其他 hook
    hooks.PreToolUse = preToolUse.map((entry) => {
      const inner = Array.isArray(entry?.hooks) ? entry.hooks : [];
      if (!inner.some((h) => owned(h?.command))) return entry;
      return {
        ...entry,
        hooks: inner.map((h) => (owned(h?.command) ? { ...h, command: desired } : h)),
      };
    });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    log(`  更新 PreToolUse hook 平面: ${desired}`);
    log(`  寫入: ${settingsPath}`);
    return;
  }

  hooks.PreToolUse = [
    ...preToolUse,
    {
      matcher: SPEX_STAMP_HOOK_MATCHER,
      hooks: [{ type: 'command', command: desired }],
    },
  ];
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  加入 PreToolUse hook: ${desired}`);
  log(`  寫入: ${settingsPath}`);
}

/**
 * 自 `.claude/settings.json` 移除章戳硬閘 hook。
 * 只移除 command 落在 SPEX_STAMP_HOOK_OWNED（兩個平面變體 + v0.7.0 舊字串）內的條目；
 * 使用者自訂 hook 一律保留。清空後的空結構逐層移除，整檔變空物件時直接刪檔。
 */
async function removeStampGuardHook(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (!raw) return;

  let settings: ClaudeSettingsFile;
  try {
    settings = JSON.parse(raw) as ClaudeSettingsFile;
  } catch {
    log(`  警告：${settingsPath} 不是合法 JSON，略過章戳硬閘 hook 清理`);
    return;
  }

  const hooks = settings.hooks;
  if (typeof hooks !== 'object' || hooks === null || !Array.isArray(hooks.PreToolUse)) return;

  const original = hooks.PreToolUse as HookMatcher[];
  const kept = original
    .map((entry) => {
      const inner = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const keptInner = inner.filter(
        (h) => !(typeof h?.command === 'string' && SPEX_STAMP_HOOK_OWNED.includes(h.command)),
      );
      return keptInner.length === inner.length ? entry : { ...entry, hooks: keptInner };
    })
    // 條目內的 hooks 全被移除（原本就只有 spex 這一支）→ 整個條目一併移除
    .filter((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.length > 0 : true));

  if (JSON.stringify(kept) === JSON.stringify(original)) return;

  if (kept.length > 0) {
    hooks.PreToolUse = kept;
  } else {
    delete hooks.PreToolUse;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  if (Object.keys(settings).length === 0) {
    await safeRemove(settingsPath, log);
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  已移除章戳硬閘 hook: ${settingsPath}`);
}

/**
 * 自 `.claude/settings.json` 移除 spex 的繞過防護規則。
 * 只移除與 SPEX_BYPASS_DENY_RULES 完全相符的字串；使用者自訂規則與其他鍵保留。
 * 清空後的空結構逐層移除，整檔變空物件時直接刪檔。鏡射 removePrAskPermissions。
 */
async function removeBypassDeny(cwd: string, log: (msg: string) => void): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (!raw) return;

  let settings: ClaudeSettingsFile;
  try {
    settings = JSON.parse(raw) as ClaudeSettingsFile;
  } catch {
    log(`  警告：${settingsPath} 不是合法 JSON，略過繞過防護規則清理`);
    return;
  }

  const permissions = settings.permissions;
  if (typeof permissions !== 'object' || permissions === null || !Array.isArray(permissions.deny)) return;

  const original = permissions.deny as unknown[];
  const kept = original.filter((rule) => !(typeof rule === 'string' && SPEX_BYPASS_DENY_RULES.includes(rule)));
  if (kept.length === original.length) return;

  if (kept.length > 0) {
    permissions.deny = kept;
  } else {
    delete permissions.deny;
  }
  if (Object.keys(permissions).length === 0) {
    delete settings.permissions;
  }

  if (Object.keys(settings).length === 0) {
    await safeRemove(settingsPath, log);
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  已移除 spex 的繞過防護規則: ${settingsPath}`);
}

/**
 * 產生寫入 .claude/rules/ 的規則內容：把 frontmatter 的 `skills:` 轉成 Claude Code
 * 的 `paths:`（指向各 skill 的 SKILL.md）。無 skills 宣告時保留原始 frontmatter，
 * 避免回退成「無 frontmatter → 每個 session 無條件載入」。
 */
function renderRuleForClaude(rule: RuleSource): string {
  const skills = getRuleSkills(rule.frontmatter);
  if (skills.length === 0) return rule.content;
  const paths = skills.map((name) => `.claude/skills/${name}/SKILL.md`);
  return matter.stringify(rule.body, { paths });
}

registerInstaller(claudeCode);

export default claudeCode;
