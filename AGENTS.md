# AGENTS.md

This file provides guidance to Codex (OpenAI Codex CLI) when working with code in this repository.

## 這是什麼

`spex` 是一支 CLI，把 SDD（spec-driven development）的 skills、子代理、reference 文件、專案規則、編輯期 hook 與 MCP 設定一鍵安裝到任何專案，並同時支援 **Claude Code**、**GitHub Copilot** 與 **OpenAI Codex CLI**。核心設計是「一份來源、多個 agent 落地」，所以大部分改動會落在資產同步流程、installer 外掛、或格式轉換這三層。

## 常用指令

```bash
npm install              # 安裝依賴；prepare 鉤子會順帶跑 tsc 產生 dist/
npm run build            # = tsc（不跑 sync-assets，避免覆蓋本地 assets）；改 src/*.ts 後驗證用
npm run dev              # tsc --watch
npm run sync-assets      # 手動 opt-in：從上游 repo 整夾覆蓋 skills/reference（會覆蓋本地編輯）
node bin/spex.js --help  # 本地執行 CLI（等同 npm start）
npm test                 # node --test dist/**/*.test.js（注意：目前尚無測試檔）
```

執行 CLI 子指令做手動驗證：`node bin/spex.js init|uninstall|mcp`。改完 `src/` 後務必先 `npm run build`，因為 `bin/spex.js` 載入的是編譯後的 `dist/cli.js`。

驗證安裝行為時用臨時目錄，不要拿真實專案試：

```bash
T=$(mktemp -d) && git -C "$T" init -q
node bin/spex.js init --cwd "$T" --agent claude-code -y
node bin/spex.js uninstall --cwd "$T" --agent claude-code -y
```

## 兩層產物，分別進不進 git

- **`assets/`（進 git，於本 repo 維護）** — `assets/skills`、`assets/agents`、`assets/reference`、`assets/rules`、`assets/hooks` 直接在本 repo 編輯。`build` 不會碰它們。`scripts/sync-assets.mjs` 僅是手動 opt-in 的上游匯入工具：它會**整夾覆蓋** `assets/skills` 與 `assets/reference`（**不**動 `assets/rules`、`assets/agents`、`assets/hooks`），所以本地已編輯過時不要隨手跑，跑前先確認變更已備份或已同步回上游。
- **`dist/`（不進 git）** — 由 `npm install` 的 `prepare` 鉤子自動 `tsc` 產生。維護者只 commit `src/` 與 `assets/`。

`npm run sync-assets` 預設來源路徑是 `../spex-source`，可用 `SOURCE_REPO=/path node scripts/sync-assets.mjs` 覆寫。

## 架構

資料流：`assets/` 的 skills / agents / reference / rules / hooks → 由 command 載入 → 交給選定的 installer → 依各 agent 格式寫入目標專案。

- **`src/cli.ts`** — commander 進入點，定義 `init / uninstall / mcp` 三個子指令，各自呼叫 `src/commands/*.ts`。
- **`src/installers/base.ts`** — 核心抽象。定義 `AgentInstaller` 介面（`detect / paths / install / configureMcp / uninstall`）、五種資產型別（`SkillSource` / `ReferenceSource` / `RuleSource` / `SubagentSource` / `HookSource`），與一個模組級 **registry**。也放共用工具：`safeWriteFile`、`getRuleSkills`、`ensureSpexTempGitignore`（只確保 `spex-temp/` 被 `.gitignore` 忽略，**不建立資料夾**——該目錄是 on-demand scratch，由 skill 用時才 `mkdir`、讀完 `rm -rf` 連資料夾移除）。
- **每個 agent 一個 installer 檔** — `claude-code.ts`、`github-copilot.ts`、`codex.ts`，檔尾呼叫 `registerInstaller(...)` 自我註冊。command 透過 **side-effect import**（`import '../installers/claude-code.js'`）把它們塞進 registry，再用 `listInstallers()` / `getInstaller(id)` 取用。
- **`src/transformers/`** — `parse-skill.ts` 用 gray-matter 從 assets 讀資產，提供 `loadSkillsFromAssets` / `loadReferencesFromAssets` / `loadRulesFromAssets` / `loadSubagentsFromAssets` / `loadHooksFromAssets` 五個載入器；`to-copilot-prompt.ts` 把 Claude 的 SKILL.md 轉成 Copilot 的 `.prompt.md`（換 frontmatter、加手動觸發提示，並把 body 內 `.claude/reference/`、`.claude/rules/` 路徑改寫為 Copilot 的 `.spex/`，**skill 跨檔引用** `.claude/skills/<name>/SKILL.md` 改寫為 `.github/prompts/<name>.prompt.md`，避免 skill 互相引用時斷鏈）。這是「一份來源餵多種 agent」的關鍵轉換層。
- **`src/mcp/servers.ts`** — 可安裝的 MCP server 目錄，**手動維護**。刻意不從 `~/.claude.json` 自動抓，避免把 token 同步進 repo。各 installer 的 `configureMcp` 各自序列化：Claude Code 寫專案根的 `.mcp.json`（`${VAR}` 佔位），Copilot 寫 `.vscode/mcp.json`（`${env:VAR}` 佔位，由 `toVsCodePlaceholder` 轉換），Codex 寫 `.codex/config.toml`（TOML；無 `${VAR}` 內插，改用 `env_vars` 轉發本機環境變數、http 用 `bearer_token_env_var`，缺的才 append、不覆寫既有區塊）。playwright server 預設關閉（`defaultEnabled: false`）。

各 agent 落地位置：

| Agent | skills | reference / rules | 子代理 | hook |
|---|---|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` | `.claude/reference/`、`.claude/rules/` | `.claude/agents/*.md` | `.claude/settings.json` 的 `hooks.PostToolUse` + `.claude/hooks/` |
| Codex | `.codex/skills/<name>/SKILL.md` | `.codex/reference/`、`.codex/rules/` ＋根目錄 `AGENTS.md` | `.codex/agents/*.toml` | `.codex/hooks.json` 的 `PostToolUse` + `.codex/hooks/` |
| Copilot | `.github/prompts/<name>.prompt.md` | `.spex/reference/`、`.spex/rules/` ＋ `.github/copilot-instructions.md` | 無落點，誠實標註 | 無落點，誠實標註 |

skill / reference / rule body 內的 `.claude/` 路徑由 `codex.ts` 的 `rewriteClaudePaths` 改寫為 `.codex/`。

## SDD 流程鏈

`write-spec → plan（技術計畫 + AC 測試對映 + 建分支；根因不明的缺陷分流 fixbug）→ 必要時 task（有獨立切片／責任分工／持久化依賴才拆）→ implement（逐 AC Red → Green → Refactor + 相關回歸，完成記「Implement 完成待 Epic 驗收」）→ 全部納入 Story 就緒後 selfcheck（一次整體 review → 一次完整機器驗證 → 一次全新上下文 verifier）→ 依授權整合`。

`schedule` 對多卡片批次自動執行時，從 base 切出**單一共用分支** `spex/schedule-<YYYYMMDD-HHmm>`（時間戳到分，同日可多批；續行依 tracker 留言記錄的分支沿用），整批卡片在此分支上逐 Story 推進，按 Epic 分組驗收，**每個 Epic 通過就整合該 Epic**，不等整批結束。

規格範本在 `assets/reference/spex/spec-template.md`，是 write-spec 產出、plan 輸入檢核、selfcheck 驗收判定的單一格式來源。

設計鐵則（動 skill 資產時不可違反）：

- **驗收單位是 Epic**（無 Epic 時為單卡）。Story 完成 focused TDD 只記「Implement 完成待 Epic 驗收」，維持 `in_progress`；該狀態可解除後續 Story 的實作依賴，但不得宣稱 Verify PASS 或已部署。
- **三道各做一次**：整體 code review、完整機器驗證、獨立 verifier，各一次。修正後只複查 delta 與受影響契約，不逐 Task／逐 Story 重做。
- **驗證失敗不得 skip**：測試失敗或需求未達成就是未完成，不可偽造輸出或把失敗改寫為 PASS。無證據 = FAIL。
- **selfcheck 的獨立性**：verifier 只拿規格、必要 Task、實際 diff 與原始機器證據，不得餵入實作推理或上游通過結論；verifier 不改 code。
- **master 需明確人工授權**：驗收 PASS 不產生授權；agent 自寫的旗標或文件不是授權來源。整合分支（`dev` / `develop` / `development`）在已授權範圍內可自動推送。
- **不設固定輪次或時間停損**：只要有可驗證的根因或下一步就繼續；缺必要外部輸入時只暫停依賴該條件的部分。
- 任務相依以 tracker 原生依賴連結為準（adapter 操作 `linkDependency` / `getDependencies`），任務留言「依賴」欄為 fallback。

## 子代理資產（`assets/agents/`）

`code-reviewer`（Epic 整體審查）與 `verifier`（獨立驗收）是唯讀子代理定義，`subagent_type` 必須有註冊定義才派得出去。

- Claude Code：原樣寫入 `.claude/agents/<name>.md`。
- Codex：由 `codex.ts` 的 `renderSubagentToml` 轉成 `.codex/agents/<name>.toml`——frontmatter 的 `name` / `description` 成為 TOML 欄位，body 進 `developer_instructions`（multi-line basic string，經 `tomlMultiline` 轉義反斜線與三連引號），並固定 `sandbox_mode = "read-only"`。
- Copilot：無原生機制，install 時輸出一行誠實標註，**不要靜默略過**。

**skill 內引用任何 `subagent_type` 前，先確認 `assets/agents/` 有對應定義**——沒有就是斷鏈。

## 編輯期 hook（`assets/hooks/`）

兩支 `PostToolUse` hook：代理以 Edit / Write / MultiEdit 異動檔案後，對「剛異動的那一個檔」跑 lint 與格式化。

- `spex-lint-edited-file.sh` — lint 失敗時把訊息寫 stderr 並 **exit 2**，讓代理接著修正。
- `spex-format-edited-file.sh` — 失敗一律 exit 0，不擋流程。
- `spex-hooks.env` — 專案自行維護的設定（`SPEX_LINT_COMMAND` / `SPEX_LINT_EXTENSIONS` / `SPEX_FORMAT_COMMAND`）。指令留空即靜默停用該支 hook，所以腳本可無條件安裝。

實作要點：

- `HookSource.isConfig`（由 `loadHooksFromAssets` 依 `.env` 副檔名判定）為 true 的檔案**即使帶 `--force` 也不覆寫**——那裡面是使用者填的專案指令。
- 腳本先留存環境已提供的值再 source 設定檔，最後把環境值蓋回去：設定檔是專案預設，環境變數優先。
- 命令一律 `bash <path>` 呼叫——腳本由 `safeWriteFile` 寫入、不帶執行位元，直接執行會因權限失敗而讓 hook 靜默失效。Claude Code 用 `$CLAUDE_PROJECT_DIR` 定位，Codex 沒有這個變數，改用 `$(git rev-parse --show-toplevel)`。
- 註冊與移除各由 installer 內的 `ensureSpexHook` / `removeSpexHooks` 處理：同 command 冪等不寫檔；移除只認所有權清單內的 command，使用者自訂 hook 一律保留。

## 教訓閉環（lessons-learned loop）

讓 SDD 流程的失敗變成跟著 repo 走、可取回的持久記憶。**格式單一來源** `assets/reference/spex/lessons-template.md`（隨 reference 機制安裝）；**治理單一來源** `assets/rules/sdd-workflow.md` 的 `## 教訓回收與升級`。教訓檔落地目標專案 `.claude/lessons/`（`L-<seq>.md` + `INDEX.md`，目錄 on-demand）。只記可重用的根因與產品防護，寫入前先比對症狀去重；流程移除時對應教訓與索引列一併刪除，不留過期記憶。路徑 `.claude/lessons/` 由 `to-copilot-prompt.ts` 的 `rewriteClaudePaths` 改寫成 `.spex/lessons/`、Codex 改寫成 `.codex/lessons/`。

## Rules（專案規則）— 取代手改 AGENTS.md

`assets/rules/*.md`（`sdd-workflow` / `commands` / `testing`）是安裝到目標專案的**專案設定**，取代要使用者手寫進 `AGENTS.md` 的章節，安裝後由專案**直接手動編輯維護**（無產生器 skill）。`commands.md` 與 `testing.md` 出廠是 TODO 樣板，由專案填入實際指令與測試工具。

skills 採**執行時讀規則檔**——主代理靠 Claude Code 自動載入 `.claude/rules/`，但子代理不繼承，故 skill 內以「依 adapters/README 的 `rg` + `sed` SOP 讀 `.claude/rules/<file>.md` 對應章節」指令為準。**測試 / E2E 工具由 `rules/testing.md` 單一決定**（不寫死任何框架）。skill body 一律用 `.claude/rules/...` 路徑，Copilot 安裝時由 `to-copilot-prompt.ts` 改寫成 `.spex/rules/...`。

**規則 scope 到指定 skill（避免污染無關工作）**：每個規則檔的 frontmatter 以 `skills:` 宣告所屬的 skill（tool-neutral 單一來源），不寫死檔案 glob。安裝時由各 installer **動態翻譯**成各工具的原生 scope：Claude Code → `.claude/rules/` 的 `paths:`（指向各 skill 的 `SKILL.md`，由 `claude-code.ts` 的 `renderRuleForClaude` 產生）；Copilot → `.github/instructions/<rule>.instructions.md` 的 `applyTo:`（指向 `.github/prompts/<name>.prompt.md`，由 `to-copilot-prompt.ts` 的 `skillsToApplyTo` 產生）；Codex → 規則檔頂部 HTML 註解標示所屬 skill（無自動 scope）。共用 helper `getRuleSkills(frontmatter)` 在 `base.ts`。注意：Claude 的 `paths:` 觸發是「讀到符合 glob 的檔案」，指向 `SKILL.md` 對「skill 被呼叫」不保證自動載入，可靠性仍靠 skill body 的 runtime-read（子代理／Codex 本就如此）。

## Tracker Adapter

skills 只呼叫 `TRACKER.*` 抽象操作，不直接打任何系統。協定在 `assets/reference/adapters/README.md`：**10 個必填操作**，adapter 不支援者須保留章節並標明限制與替代方案，不可刪章節。生效的 adapter 由 `assets/rules/sdd-workflow.md` 的 `Tracker Adapter:` 一行決定，切換只改那一行。新增 adapter 走 `/create-adapter`。

## 新增一個 agent（如 Cursor）

1. 新增 `src/installers/<name>.ts`，實作 `AgentInstaller` 介面，檔尾 `registerInstaller(...)`。
2. 在 `src/commands/init.ts`、`uninstall.ts`、`mcp.ts` 補一行 side-effect import（registry 靠 import 才會被填充）。新 installer 必須實作 `AgentInstaller.uninstall(ctx)`，否則無法被 `spex uninstall` 解除安裝。
3. 決定五種資產各自的落點：skills / reference / rules / subagents / hooks。
4. 該 agent 沒有子代理或 hook 機制時，**不要靜默略過**——比照 Copilot 於 install 時輸出一行誠實標註，說明該能力在此環境不存在、需要怎麼替代，不得讓使用者以為裝了等價能力。

主流程（commands）不需要其他改動。

## 不可違反的鐵則：token 絕不落檔

機密（PAT / API key）一律以 `${VAR}` / `${env:VAR}` 佔位寫進設定檔，實際值由使用者放在 shell 環境（`~/.zshrc`）或 CI Secret。**禁止**在專案內建立 `.env`、`.env.local` 或任何含明文 token 的檔案——即使加進 `.gitignore` 也違反政策。`mcp setup` 跑完只會「列出」缺哪些環境變數並印 `echo … >> ~/.zshrc` 指令，不會代寫。

## 慣例

- ESM 專案（`"type": "module"`）。TS 相對 import 一律帶 `.js` 副檔名（指向編譯產物），例如 `from './commands/init.js'`。
- TypeScript strict mode；避免 `any`。
- **註解、文件、CLI 輸出、commit message 用繁體中文**；程式識別字（function / variable / type）用英文。
- Commit message 遵循 Conventional Commits：`type(scope): 繁中描述`。
