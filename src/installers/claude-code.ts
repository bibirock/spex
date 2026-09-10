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
  type AgentInstaller,
  type HookSource,
  type InstallContext,
  type McpContext,
  type RuleSource,
  type UninstallContext,
} from './base.js';

const AGENTS_REL = path.join('.claude', 'agents');
const HOOKS_REL = path.join('.claude', 'hooks');
const SETTINGS_REL = path.join('.claude', 'settings.local.json');
const SETTINGS_JSON_REL = path.join('.claude', 'settings.json');
const MCP_REL = '.mcp.json';

/**
 * 編輯期 hook 掛在 `PostToolUse`：檔案已經寫完才輪到 lint 與格式化。
 * matcher 對應會產生檔案異動的三個工具。
 */
const HOOK_EVENT = 'PostToolUse';
const HOOK_MATCHER = 'Edit|Write|MultiEdit';

/**
 * 以 `bash <path>` 呼叫而非直接執行：hook 腳本透過 safeWriteFile 寫入、不帶執行位元，
 * 直接執行會因權限失敗而讓 hook 靜默失效。
 */
const hookCommand = (fileName: string): string =>
  `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/${fileName}"`;

/** 只有可執行的 hook 腳本要掛進 settings；`.env` 是它們讀的設定檔。 */
const executableHooks = (hooks: HookSource[]): HookSource[] =>
  hooks.filter((h) => !h.isConfig);

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
  hooks?: Record<string, unknown>;
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
      hooks: path.join(cwd, HOOKS_REL),
      temp: path.join(cwd, 'spex-temp'),
      mcp: path.join(cwd, MCP_REL),
    };
  },

  async install(ctx: InstallContext): Promise<void> {
    const { cwd, skills, references, rules, subagents, hooks, force, log } = ctx;
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
    // code-reviewer 與 verifier 必須是註冊過的 subagent_type 才派得出去；
    // 缺定義 = spex-selfcheck 的整體 review 與獨立驗收無法執行。
    for (const agent of subagents) {
      const target = path.join(cwd, AGENTS_REL, agent.relativePath);
      await safeWriteFile(target, agent.content, { force, log });
    }

    log('\n→ 安裝編輯期 hook 到 .claude/hooks/');
    for (const hook of hooks) {
      const target = path.join(cwd, HOOKS_REL, hook.relativePath);
      // 設定檔裝的是使用者填的專案指令，即使帶 --force 也不覆寫。
      await safeWriteFile(target, hook.content, {
        force: hook.isConfig ? false : force,
        log,
      });
    }

    log('\n→ 更新 .gitignore（spex-temp/ 改為 on-demand scratch，skill 用時才建立）');
    await ensureSpexTempGitignore(cwd, log);

    log(`\n→ 設定編輯期 hook（.claude/settings.json 的 ${HOOK_EVENT}）`);
    for (const hook of executableHooks(hooks)) {
      await ensureSpexHook(cwd, hookCommand(hook.relativePath), log);
    }
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
    const { cwd, skills, references, rules, subagents, hooks, full, mcpServerIds, log } = ctx;
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

    if (hooks.length > 0) {
      log('\n→ 移除編輯期 hook（.claude/hooks/）');
      for (const hook of hooks) {
        await safeRemove(path.join(cwd, HOOKS_REL, hook.relativePath), log);
      }
      await removeDirIfEmpty(path.join(cwd, HOOKS_REL), log);

      log('\n→ 移除 hook 條目（.claude/settings.json）');
      await removeSpexHooks(
        cwd,
        executableHooks(hooks).map((h) => hookCommand(h.relativePath)),
        log,
      );
    }

    if (!full) return;

    log('\n→ 移除 MCP 設定（.mcp.json）');
    await removeJsonMcpServers(paths.mcp, 'mcpServers', mcpServerIds, log);

    log('\n→ 移除 spex-temp/ 並還原 .gitignore');
    await removeSpexTemp(cwd, log);

    // 若 .claude/ 已被清空（沒有使用者其他內容）則一併移除
    await removeDirIfEmpty(path.join(cwd, '.claude'), log);
  },
};

/**
 * 把一支 hook 合併進專案 `.claude/settings.json` 的對應事件陣列。
 * 不可破壞 merge：保留使用者既有的其他 hook 條目與其 matcher。
 * 已存在同一 command 即冪等返回；否則 append 一個新條目。
 * 寫進專案層 settings.json（而非 settings.local.json）讓 hook 可進版控、整個團隊共用。
 */
async function ensureSpexHook(
  cwd: string,
  command: string,
  log: (msg: string) => void,
): Promise<void> {
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

  if (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  const hooks = settings.hooks;
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
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  加入 ${HOOK_EVENT} hook: ${command}`);
  log(`  寫入: ${settingsPath}`);
}

/**
 * 自 `.claude/settings.json` 移除 spex 的 hook 條目。
 * 只移除 command 落在所有權清單內的項目；使用者自訂 hook 一律保留。
 * 清空後的空結構逐層移除，整檔變空物件時直接刪檔。
 */
async function removeSpexHooks(
  cwd: string,
  owned: readonly string[],
  log: (msg: string) => void,
): Promise<void> {
  const settingsPath = path.join(cwd, SETTINGS_JSON_REL);
  const raw = await fs.readFile(settingsPath, 'utf8').catch(() => null);
  if (!raw) return;

  let settings: ClaudeSettingsFile;
  try {
    settings = JSON.parse(raw) as ClaudeSettingsFile;
  } catch {
    log(`  警告：${settingsPath} 不是合法 JSON，略過 hook 清理`);
    return;
  }

  const hooks = settings.hooks;
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
    // 條目內的 hooks 全被移除（原本就只有 spex 這一支）→ 整個條目一併移除
    .filter((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.length > 0 : true));

  if (JSON.stringify(kept) === JSON.stringify(original)) return;

  if (kept.length > 0) {
    hooks[HOOK_EVENT] = kept;
  } else {
    delete hooks[HOOK_EVENT];
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  if (Object.keys(settings).length === 0) {
    await safeRemove(settingsPath, log);
    return;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  log(`  已移除 spex 的 ${HOOK_EVENT} hook: ${settingsPath}`);
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
