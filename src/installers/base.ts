import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SkillSource {
  /** skill 名稱（資料夾名，例如 spex-plan） */
  name: string;
  /** SKILL.md 解析出的 YAML frontmatter */
  frontmatter: Record<string, unknown>;
  /** SKILL.md 去除 frontmatter 後的 markdown 內文 */
  body: string;
  /** 來源檔絕對路徑（debug 用） */
  sourcePath: string;
}

export interface ReferenceSource {
  /** 相對於 assets/reference/ 的路徑，例如 "adapters/azure-devops/ado.md" */
  relativePath: string;
  content: string;
}

export interface RuleSource {
  /** 相對於 assets/rules/ 的路徑，例如 "testing.md" */
  relativePath: string;
  /** 原始檔內容（含 frontmatter）— debug / 對照用 */
  content: string;
  /** 解析出的 YAML frontmatter（含 skills: 宣告本規則所屬的 skill） */
  frontmatter: Record<string, unknown>;
  /** 去除 frontmatter 後的內文 — Copilot / Codex 寫入用 */
  body: string;
}

/**
 * subagent 定義（`assets/agents/*.md`）— 例如 challenger / verifier。
 * 章戳鏈要求詰問者與驗收者是「全新上下文、唯讀」的獨立 subagent，且派發時以
 * `subagent_type` 指名；沒有註冊的 agent 定義就派不出去，所以這是 skill 之外的
 * 獨立資產型別。目前只有 Claude Code 有原生 subagent 機制（`.claude/agents/`），
 * Copilot / Codex 無對應落點，由各 installer 自行決定如何誠實標註。
 */
export interface SubagentSource {
  /** agent 名稱（frontmatter name，fallback 為檔名主體）— 即派發時的 subagent_type */
  name: string;
  /** 相對於 assets/agents/ 的路徑，例如 "challenger.md" */
  relativePath: string;
  /** 原始檔內容（含 frontmatter）— 直接寫入目標專案 */
  content: string;
}

/**
 * 從 rule frontmatter 取出 `skills:` 宣告 — 本規則所屬的 skill 清單。
 * 各 installer 依此把規則 scope 到對應 skill 的落地位置（Claude `paths:`、
 * Copilot `applyTo:`、Codex HTML 註解），避免規則污染使用者的無關工作。
 * 容忍 string | string[]；trim、去空、去重後回傳。
 */
export function getRuleSkills(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.skills;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cleaned = list
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
}

/**
 * spex 治理的「繞過管道」指令家族（MCP-only 政策的**中層**防護）。
 * 這些是 AI 可能用來繞過受控 MCP/TRACKER、直打底層 API/CLI 的指令前綴：
 * raw HTTP（`curl` / `wget`）、ADO work item CLI（`az boards`）、GitHub API CLI（`gh api`）。
 * 各 installer 把它翻譯成原生格式（Claude `permissions.deny`、Copilot `denyList`、
 * Codex sandbox 封網路），讓「繞過 MCP」這條路在權限/sandbox 層就跑不起來。
 *
 * 刻意**不**含 `az repos pr create` / `gh pr create`——那兩條開 PR 管道由
 * `SPEX_PR_ASK_RULES` 設為 `permissions.ask`（保留人工核准逃生口），不可被 deny 蓋掉。
 *
 * 此常數是「一份來源、多 agent 落地」的單一來源，也是 uninstall 的所有權清單依據：
 * 各 installer 只移除由它翻譯出、與當前內容完全相符的項目，使用者自訂規則一律保留。
 *
 * 註：本層對 compound command、wrapper、env-var 內插等變體較脆弱；不可繞過的執行期
 * 硬擋（PreToolUse exit-2 hook）為**另案**，本常數不負責。
 */
export const SPEX_BYPASS_COMMANDS: readonly string[] = [
  'curl',
  'wget',
  'az boards',
  'gh api',
];

/**
 * 安裝版本（平面）——決定裝哪些資產、以及章戳鏈的驗章硬閘落在哪裡。
 * - `agent`（預設）：無沙盒。寫碼與驗證都在同一份原始碼樹，章源＝本 session 事件流，
 *   驗章硬閘＝Claude Code 的 PreToolUse hook（`spex-stamp-guard.sh --plane agent`）。
 * - `sandbox`：加裝 Docker 沙盒協定與 relay。章源＝host 影子流（容器物理寫不到），
 *   驗章硬閘＝relay 執行檔自身；hook 轉為 `--plane sandbox`，只擋「host 直發含章留言」。
 */
export type InstallMode = 'agent' | 'sandbox';

/**
 * 只有沙盒平面用得到的 skill——`agent` 模式不安裝。
 * 此常數是模式過濾的單一來源（`transformers/install-mode.ts` 依它篩選）。
 */
export const SPEX_SANDBOX_ONLY_SKILLS: readonly string[] = [
  'spex-sandbox-init',
  'spex-relay-init',
];

/**
 * 只有沙盒平面用得到的 reference（比對 `ReferenceSource.relativePath` 前綴）。
 * 注意 `spex/scripts/` 四支腳本（challenge-audit / transcript-to-stream /
 * spex-stamp-guard / task-draft-lint）**兩種模式都要裝**，不列在此。
 */
export const SPEX_SANDBOX_ONLY_REFERENCES: readonly string[] = [
  'sandboxes/',
  'spex/relay-protocol.md',
];

export interface McpServerDefinition {
  id: string;
  /** 安裝引導顯示用的中文描述 */
  description: string;
  /** stdio 類型：command + args；http 類型：url */
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  /**
   * stdio server 的 env 區塊內容（直接寫入 mcp.json）。
   * 值可以是寫死的字串，或含有 ${VAR} 佔位（由 envVars 提供使用者輸入）。
   * 若定義為空物件，會輸出 "env": {}（例如 playwright）。
   */
  env?: Record<string, string>;
  /**
   * http server 的 headers 區塊內容（直接寫入 mcp.json）。
   * 值可以是寫死的字串，或含有 ${VAR} 佔位。
   */
  headers?: Record<string, string>;
  /**
   * 需要的環境變數（PAT 等）— 一律從 shell 環境讀取（`~/.zshrc` / `~/.bashrc` / CI Secret）。
   * 禁止寫入專案內任何檔案（policy: `AZURE_DEVOPS_PAT` 只能從環境變數讀取）。
   */
  envVars?: Array<{
    name: string;
    description: string;
    /** 取得 token 的指引網址 */
    helpUrl?: string;
  }>;
  /** 此 server 是否預設啟用 */
  defaultEnabled?: boolean;
}

export interface InstallContext {
  /** 安裝目標的專案根目錄 */
  cwd: string;
  /**
   * 安裝版本。資產過濾與沙盒段落剝除已在上游（`commands/init.ts`）完成，
   * installer 只用它決定 hook 變體與 log 文案。
   */
  mode: InstallMode;
  /** 使用者選擇要安裝的 skill 列表 */
  skills: SkillSource[];
  /** 使用者選擇要安裝的 reference 檔案 */
  references: ReferenceSource[];
  /** 要安裝的 rules 檔案（專案規則，skill 執行時讀取） */
  rules: RuleSource[];
  /** 要安裝的 subagent 定義（challenger / verifier；僅 Claude Code 有原生落點） */
  subagents: SubagentSource[];
  /** 是否覆寫已存在的檔案 */
  force: boolean;
  /** 安裝過程的記錄 callback */
  log: (msg: string) => void;
}

export interface McpContext {
  cwd: string;
  servers: McpServerDefinition[];
  log: (msg: string) => void;
}

export interface UninstallContext {
  /** 解除安裝目標的專案根目錄 */
  cwd: string;
  /**
   * 要移除的 skill 列表。只移除這些名稱對應的 skill 檔案／資料夾，
   * 不碰使用者自行新增的其他 skill。
   */
  skills: SkillSource[];
  /** 要移除的 reference 檔案（partial 模式為空陣列，不動共用 reference） */
  references: ReferenceSource[];
  /** 要移除的 rules 檔案（partial 模式為空陣列，不動共用 rules） */
  rules: RuleSource[];
  /** 要移除的 subagent 定義（partial 模式為空陣列，不動共用 agents） */
  subagents: SubagentSource[];
  /** 是否一併移除整個 spex 安裝（含 reference / rules / agent 文件 / temp / MCP） */
  full: boolean;
  /** full 模式下，要從 MCP 設定移除的 spex server id 清單 */
  mcpServerIds: string[];
  /** 解除安裝過程的記錄 callback */
  log: (msg: string) => void;
}

export interface AgentInstaller {
  /** 唯一識別字串，例如 "claude-code"、"github-copilot" */
  id: string;
  /** 顯示給使用者的中文名稱 */
  displayName: string;

  /**
   * 偵測目標目錄是否已經是此 agent 的使用者。
   * 例：claude-code 看 .claude/ 是否存在；copilot 看 .github/copilot-instructions.md。
   * 偵測結果只是「優先推薦」依據，不是強制條件。
   */
  detect(cwd: string): Promise<boolean>;

  /** 回傳此 agent 會寫入 / 讀取的關鍵路徑（doctor、list 用） */
  paths(cwd: string): {
    skills: string;
    reference: string;
    rules: string;
    /** subagent 定義落點；無原生 subagent 機制的 agent（Copilot / Codex）不提供 */
    agents?: string;
    temp?: string;
    mcp: string;
  };

  /** 安裝 skills 與 reference 檔案 */
  install(ctx: InstallContext): Promise<void>;

  /** 寫入 MCP 設定（不會處理敏感 token，token 由 CLI 引導使用者設環境變數） */
  configureMcp(ctx: McpContext): Promise<void>;

  /** 移除已安裝的 spex 資產（skills／reference／rules／agent 文件／MCP 設定） */
  uninstall(ctx: UninstallContext): Promise<void>;
}

const SPEX_TEMP_REL = 'spex-temp';
const SPEX_TEMP_GITIGNORE_COMMENT = '# Spex temp files';
// spex-temp/ 改為「用時才建、用後即刪」的 on-demand scratch 區（skill 下載附件/截圖時
// 才 mkdir，讀完以 rm -rf 連資料夾一起移除）。安裝階段不再建立資料夾，只確保整個目錄被 git 忽略。
const SPEX_TEMP_GITIGNORE_RULE = 'spex-temp/';
// 舊版（pre-on-demand）規則：安裝升級與 uninstall 時一併清掉，避免殘留矛盾的 .gitkeep 負規則。
const SPEX_TEMP_GITIGNORE_LEGACY = [
  'spex-temp/*',
  '!spex-temp/.gitkeep',
];

/** 將檔案寫入指定路徑，必要時建立父資料夾；若已存在且非 force 則跳過 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  opts: { force: boolean; log: (msg: string) => void },
): Promise<'written' | 'skipped'> {
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (exists && !opts.force) {
    opts.log(`  跳過（已存在，使用 --force 可覆寫）: ${filePath}`);
    return 'skipped';
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  opts.log(`  ${exists ? '覆寫' : '寫入'}: ${filePath}`);
  return 'written';
}

/**
 * 確保 spex-temp/ 這個 on-demand scratch 區被 git 忽略——**不建立資料夾**。
 * 資料夾改由 skill 在需要時（下載附件 / 截圖 / log）自行 mkdir，用完即以 rm -rf 連資料夾移除。
 * 安裝階段只負責把忽略規則寫進 .gitignore，作為「清理被中斷時不誤入 git」的安全網。
 */
export async function ensureSpexTempGitignore(
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const current = await fs.readFile(gitignorePath, 'utf8').catch(() => '');

  const lines = current.split(/\r?\n/);
  const trimmed = lines.map((l) => l.trim());
  const legacy = new Set(SPEX_TEMP_GITIGNORE_LEGACY);
  const hasRule = trimmed.includes(SPEX_TEMP_GITIGNORE_RULE);
  const hasLegacy = trimmed.some((l) => legacy.has(l));

  // 已是正確狀態（有新規則、無殘留 legacy）→ 冪等返回，不動檔案。
  if (hasRule && !hasLegacy) return;

  // 移除所有「本工具管理」的行（註解 + 新規則 + legacy 規則），再以乾淨區塊重附加，
  // 確保註解與規則相鄰、且不殘留 .gitkeep 負規則。
  const managed = new Set([
    SPEX_TEMP_GITIGNORE_COMMENT,
    SPEX_TEMP_GITIGNORE_RULE,
    ...SPEX_TEMP_GITIGNORE_LEGACY,
  ]);
  const kept = lines.filter((l) => !managed.has(l.trim()));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  const body = kept.join('\n');
  const prefix = body.length === 0 ? '' : '\n\n';
  const next = `${body}${prefix}${SPEX_TEMP_GITIGNORE_COMMENT}\n${SPEX_TEMP_GITIGNORE_RULE}\n`;
  if (next === current) return;

  await fs.writeFile(gitignorePath, next, 'utf8');
  log(`  更新: ${gitignorePath}`);
}

/** 移除檔案或資料夾（遞迴）；不存在則靜默略過。回傳是否真的移除了東西。 */
export async function safeRemove(
  targetPath: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const exists = await fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) return false;
  await fs.rm(targetPath, { recursive: true, force: true });
  log(`  移除: ${targetPath}`);
  return true;
}

/**
 * 由下而上清除空資料夾：先遞迴處理子資料夾，全部子項清光後再移除自己。
 * 用於移除安裝後留下的空殼（例如清掉所有 reference 檔後的 reference/adapters/...）；
 * 只要還有任何使用者檔案存在就會保留該層及其上層。
 */
export async function removeDirIfEmpty(
  dir: string,
  log: (msg: string) => void,
): Promise<void> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => null);
  if (entries === null) return;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeDirIfEmpty(path.join(dir, entry.name), log);
    }
  }

  const remaining = await fs.readdir(dir).catch(() => null);
  if (remaining && remaining.length === 0) {
    await fs.rmdir(dir);
    log(`  移除空目錄: ${dir}`);
  }
}

/**
 * 從 JSON 格式的 MCP 設定檔移除指定的 spex server。
 * - Claude Code（.mcp.json）：server 物件鍵為 `mcpServers`
 * - GitHub Copilot（.vscode/mcp.json）：server 物件鍵為 `servers`
 *
 * 只移除清單內的 server id，保留使用者自訂的其他 server；
 * 若移除後 server 物件全空且檔內無其他欄位，則刪除整個檔案。
 */
export async function removeJsonMcpServers(
  mcpPath: string,
  serversKey: string,
  serverIds: string[],
  log: (msg: string) => void,
): Promise<void> {
  const raw = await fs.readFile(mcpPath, 'utf8').catch(() => null);
  if (raw === null) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log(`  警告：${mcpPath} 不是合法 JSON，未變更（請手動移除 spex server）`);
    return;
  }

  const servers = (parsed[serversKey] as Record<string, unknown>) ?? {};
  let removed = 0;
  for (const id of serverIds) {
    if (id in servers) {
      delete servers[id];
      removed++;
      log(`  移除 server: ${id}`);
    }
  }
  if (removed === 0) return;

  if (Object.keys(servers).length === 0) {
    delete parsed[serversKey];
  } else {
    parsed[serversKey] = servers;
  }

  if (Object.keys(parsed).length === 0) {
    await safeRemove(mcpPath, log);
    return;
  }
  await fs.writeFile(mcpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  log(`  更新: ${mcpPath}`);
}

/** 移除 spex-temp 目錄，並清掉 .gitignore 內由本工具加入的規則區塊。 */
export async function removeSpexTemp(
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  await safeRemove(path.join(cwd, SPEX_TEMP_REL), log);
  await removeGitignoreRules(cwd, log);
}

/** 從 .gitignore 移除 spex-temp 規則（含註解標題）；不影響使用者其他規則。 */
async function removeGitignoreRules(
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const current = await fs.readFile(gitignorePath, 'utf8').catch(() => null);
  if (current === null) return;

  const drop = new Set<string>([
    SPEX_TEMP_GITIGNORE_COMMENT,
    SPEX_TEMP_GITIGNORE_RULE,
    ...SPEX_TEMP_GITIGNORE_LEGACY,
  ]);
  const kept = current
    .split(/\r?\n/)
    .filter((line) => !drop.has(line.trim()));
  // 去掉因移除而產生的結尾連續空行
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  const next = kept.length > 0 ? kept.join('\n') + '\n' : '';
  if (next === current) return;

  if (next.trim() === '') {
    await safeRemove(gitignorePath, log);
  } else {
    await fs.writeFile(gitignorePath, next, 'utf8');
    log(`  更新: ${gitignorePath}`);
  }
}

/** Installer 註冊表 — 新增 agent 只需在這裡 push */
const registry: AgentInstaller[] = [];

export function registerInstaller(installer: AgentInstaller): void {
  if (registry.find((r) => r.id === installer.id)) {
    throw new Error(`Installer 已註冊: ${installer.id}`);
  }
  registry.push(installer);
}

export function listInstallers(): AgentInstaller[] {
  return [...registry];
}

export function getInstaller(id: string): AgentInstaller | undefined {
  return registry.find((r) => r.id === id);
}
