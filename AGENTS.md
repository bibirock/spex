# AGENTS.md

This file provides guidance to Codex (OpenAI Codex CLI) when working with code in this repository.

## 這是什麼

`spex` 是一支 CLI，把 SDD（spec-driven development）的 skills、reference 文件與 MCP 設定一鍵安裝到任何專案，並同時支援 **Claude Code**、**GitHub Copilot** 與 **OpenAI Codex CLI**。核心設計是「一份來源、多個 agent 落地」，所以大部分改動會落在資產同步流程、installer 外掛、或格式轉換這三層。

## 常用指令

```bash
npm install              # 安裝依賴；prepare 鉤子會順帶跑 tsc 產生 dist/
npm run build            # = tsc（不跑 sync-assets，避免覆蓋本地 assets）；改 src/*.ts 後驗證用
npm run dev              # tsc --watch
npm run sync-assets      # 手動 opt-in：從上游 repo 整夾覆蓋 skills/reference（會覆蓋本地編輯）
node bin/spex.js --help   # 本地執行 CLI（等同 npm start）
npm test                 # node --test dist/**/*.test.js（注意：目前尚無測試檔）
```

執行 CLI 子指令做手動驗證：`node bin/spex.js init|uninstall|mcp`。改完 `src/` 後務必先 `npm run build:ts`，因為 `bin/spex.js` 載入的是編譯後的 `dist/cli.js`。

## 兩層產物，分別進不進 git

- **`assets/`（進 git，於本 repo 維護）** — `assets/skills`、`assets/reference`、`assets/rules` 直接在本 repo 編輯。`build` 不會碰它們。`scripts/sync-assets.mjs` 僅是手動 opt-in 的上游匯入工具：它會**整夾覆蓋** `assets/skills` 與 `assets/reference`（**不**動 `assets/rules`），所以本地已編輯過時不要隨手跑，跑前先確認變更已備份或已同步回上游。
- **`dist/`（不進 git）** — 由 `npm install` 的 `prepare` 鉤子自動 `tsc` 產生。維護者只 commit `src/` 與 `assets/`。

`npm run sync-assets` 預設來源路徑是 `../spex-source`，可用 `SOURCE_REPO=/path node scripts/sync-assets.mjs` 覆寫。

## 架構

資料流：`assets/` 的 skills / reference / **rules** → 由 command 載入 → 交給選定的 installer → 依各 agent 格式寫入目標專案。

- **`src/cli.ts`** — commander 進入點，定義 `init / uninstall / mcp` 三個子指令，各自呼叫 `src/commands/*.ts`。
- **`src/installers/base.ts`** — 核心抽象。定義 `AgentInstaller` 介面（`detect / paths / install / configureMcp`）、`SkillSource` / `ReferenceSource` / `RuleSource` 三種資產型別、**`InstallMode` 與沙盒專屬資產清單**（見下方「安裝版本」），與一個模組級 **registry**。也放共用工具：`safeWriteFile`、`ensureSpexTempGitignore`（只確保 `spex-temp/` 被 `.gitignore` 忽略，**不建立資料夾**——該目錄改為 on-demand scratch，由 skill 用時才 `mkdir`、讀完 `rm -rf` 連資料夾移除）。
- **每個 agent 一個 installer 檔** — `claude-code.ts`、`github-copilot.ts`、`codex.ts`，檔尾呼叫 `registerInstaller(...)` 自我註冊。command 透過 **side-effect import**（`import '../installers/claude-code.js'`）把它們塞進 registry，再用 `listInstallers()` / `getInstaller(id)` 取用。
- **`src/transformers/`** — `parse-skill.ts` 用 gray-matter 從 assets 讀 SKILL.md，並提供 `loadSkillsFromAssets` / `loadReferencesFromAssets` / `loadRulesFromAssets` 三個載入器；**`install-mode.ts`** 依安裝版本過濾資產與剝除沙盒段落（見下方「安裝版本」）；`to-copilot-prompt.ts` 把 Claude 的 SKILL.md 轉成 Copilot 的 `.prompt.md`（換 frontmatter、加手動觸發提示，並把 body 內 `.claude/reference/`、`.claude/rules/` 路徑改寫為 Copilot 的 `.spex/`，**skill 跨檔引用** `.claude/skills/<name>/SKILL.md` 改寫為 `.github/prompts/<name>.prompt.md`，避免 skill 互相引用時斷鏈）。這是「一份來源餵兩種 agent」的關鍵轉換層。
- **`src/mcp/servers.ts`** — 可安裝的 MCP server 目錄，**手動維護**。刻意不從 `~/.claude.json` 自動抓，避免把 token 同步進 repo。各 installer 的 `configureMcp` 各自序列化：Claude Code 寫專案根的 `.mcp.json`（`${VAR}` 佔位），Copilot 寫 `.vscode/mcp.json`（`${env:VAR}` 佔位，由 `toVsCodePlaceholder` 轉換），Codex 寫 `.codex/config.toml`（TOML；無 `${VAR}` 內插，改用 `env_vars` 轉發本機環境變數、http 用 `bearer_token_env_var`，缺的才 append、不覆寫既有區塊）。playwright server 預設關閉（`defaultEnabled: false`）。

**資產型別 `agents`**：`assets/agents/*.md`——章戳鏈的 challenger / verifier，以及 `spex-implement` 品質審查用的 **code-reviewer**。`subagent_type` 必須有註冊定義才派得出去，只有 Claude Code 有落點（`.claude/agents/`），Codex / Copilot 無對應、安裝時誠實標註。**skill 內引用任何 `subagent_type` 前，先確認 `assets/agents/` 有對應定義**——沒有就是斷鏈（`/code-reviewer` 曾被誤寫成「官方 Claude Code skill」，官方並沒有這支指令）。

各 agent 落地位置差異：Claude Code → `.claude/skills/<name>/SKILL.md` + `.claude/reference/` + `.claude/rules/`；Copilot → `.github/prompts/<name>.prompt.md` + `.spex/reference/` + `.spex/rules/` + `.github/copilot-instructions.md`；Codex → `.codex/skills/<name>/SKILL.md` + `.codex/reference/` + `.codex/rules/` + 根目錄 `AGENTS.md`（skill body 內 `.claude/` 路徑由 `codex.ts` 改寫為 `.codex/`）。

## SDD 流程鏈（v0.5.0 起）

`write-spec →（規格貼 work item description）→ plan（分類 + 技術計畫；Tier 1 直開單張子卡；缺陷 M/L 分流 fixbug）→ task（拆卡 + 寫入依賴連結）→ implement（TDD，依 ADO 依賴連結建 DAG 依序執行，不開 PR）→ selfcheck（獨立驗收）→ pull-request（PR 唯一入口）`；`schedule` 對**多卡片**批次（或單卡無人值守）自動執行時，從 base 切出**單一共用分支** `chore/schedule-<YYYYMMDD-HHmm>`（時間戳到分，同日可多批；續行依 tracker 留言記錄的分支沿用），整批所有卡片在此分支上逐卡依序套用實作鏈（plan→task→implement→selfcheck，卡片終態 = Verify PASS），**不逐卡建分支、不逐卡開 PR**；對帳通過後**呼叫** pull-request（批次最終模式）開**一個**涵蓋全批的 PR 給使用者確認（level-triggered：每輪重新從 tracker 盤點、終態唯一 done/blocked、結束前對帳；搭配 /goal 或 /loop 循環檢查）。已無 `spex-clarity`（職責拆給 write-spec 與 plan）、無 `spex-orchestrate`（卡內依序執行歸 implement、跨 skill 銜接歸 schedule）、無 `create-sdd-workflow`（規則檔安裝後直接手動維護）。規格範本在 `assets/reference/spex/spec-template.md`，是 write-spec 產出、plan 輸入檢核、selfcheck 驗收判定的單一格式來源。

設計鐵則（動 skill 資產時不可違反）：

- **`TRACKER.createPullRequest` 只允許出現在 `spex-pull-request`**；implement / schedule 不得直接開 PR。這是為了讓 Verify / 章戳 Gate 有統一收口，**不是**對開 PR 的防護（開 PR 屬一般流程）——不可逆的合併另有專屬硬閘，見「PR 合併防護」。
- **驗證失敗不得 skip**：implement F.4 走到底是 Fail 判定（寫 `Verify Fail` 留言、停鏈），不存在「跳過測試繼續」路徑；selfcheck 無證據 = Fail、重做上限 3 輪。
- **selfcheck 的獨立性**：驗證者只拿 AC + diff + 機器證據，不得餵入實作推理；驗證者不改 code。
- implement 主 agent 依序執行任務、不派 subagent（token 策略）；品質審查（`code-reviewer` subagent、PR 級審查）與 selfcheck 驗證者不在此限。
- 任務相依以 ADO 原生 Predecessor/Successor 連結為準（adapter 操作 `linkDependency` / `getDependencies`），任務留言「依賴」欄為 fallback。

## 安裝版本（agent / sandbox 雙平面）

`spex init` 有兩種安裝版本（`--mode agent|sandbox`，`--sandbox` 為語法糖），對應章戳鏈的兩個平面。**選錯版本 = 章源與硬閘對不上 = 假 FAIL**，動這塊時務必先讀懂下表。

| 版本 | tracker 寫入 | 章源 | 驗章硬閘 |
|---|---|---|---|
| `agent`（預設） | skill 直接呼叫 MCP | 本 session 事件流 `~/.claude/projects/` | Claude Code PreToolUse hook `spex-stamp-guard.sh --plane agent` |
| `sandbox` | 容器吐 `[TRACKER-ACTION]` → host relay 代寫 | host 影子流（容器物理寫不到） | relay 執行檔自身；hook 轉 `--plane sandbox`，只擋 host 直發的含章留言 |

實作分佈：

- **單一來源在 `base.ts`**：`InstallMode`、`SPEX_SANDBOX_ONLY_SKILLS`（`spex-sandbox-init` / `spex-relay-init`）、`SPEX_SANDBOX_ONLY_REFERENCES`（`sandboxes/` / `spex/relay-protocol.md`）。要增減沙盒專屬資產只改這兩張清單。**`reference/spex/scripts/` 四支腳本兩種模式都裝**，不列入清單。
- **`transformers/install-mode.ts`** 集中做過濾與剝除，讓三個 installer 保持模式無關（只有 `claude-code.ts` 因為要選 hook 變體才用到 `ctx.mode`）。`applyInstallMode()` 在 `commands/init.ts` 載入資產後、`installer.install()` 前套用一次。
- **圍欄機制**：共用資產（`spex-stamp/SKILL.md`、`rules/sdd-workflow.md`）裡描述沙盒平面的段落用 `<!-- spex:sandbox-only:start / end -->` 包起來，agent 模式安裝時剝除。支援**整行圍欄**（跨多行）與**行內圍欄**（表格儲存格內只拿掉半句）。skill frontmatter 不套圍欄——`description` 一律寫成平面中性措辭。rule frontmatter 的 `skills:` 由 `withoutSandboxSkills()` 過濾掉沙盒 skill，避免產生指向不存在檔案的 scope。
- **hook 的三態註冊**：命令常數 `SPEX_STAMP_HOOK_COMMANDS`、所有權清單 `SPEX_STAMP_HOOK_OWNED`（另含 v0.7.0 無參數舊字串）。`ensureStampGuardHook` 同平面冪等不寫檔／不同 owned 變體**就地替換 command**／都沒有才 append。**絕不可讓兩個平面的 hook 同時掛著**。Codex 無 hook 機制，`mode === 'sandbox'` 時只輸出一行誠實標註。
- **多支 PreToolUse hook 並存**（僅 Claude Code）：agent 版 2 支（`spex-stamp-guard.sh` 守章戳鏈、`spex-merge-guard.sh` 守 PR 合併控管）；沙盒版再加 `sandbox-guard.sh` 守雙平面邊界共 3 支。任一 exit 2 即擋；合併規則「只增不換」寫在 `settings.sandbox-snippet.json.tmpl` 的 `_comment_hook_coexistence` 與 `sandboxes/README.md`。
- **⚠️ 不可誤剝**：`sdd-workflow.md` 的 `## MCP-only` 提到 Codex 的 `sandbox_mode` / `approval_policy`，那是 Codex CLI **自己的沙盒設定**，與 Docker 沙盒平面無關，絕對不能加圍欄。改完務必跑一次剝除後的殘留檢查。

## PR 合併防護（claude-code installer）

**政策自 v0.9.0 反轉**：舊版把防護押在 PR **開立**（`permissions.ask` 三條），但開 PR 可逆、可審查，擋它只是插一次人工等待；真正不可逆的是**合併**。現在開 PR 回歸一般流程，防護全部搬到合併端，**無逃生口**（互動 session 也不放行）。

單一來源在 `base.ts`：`SPEX_MERGE_DENY_COMMANDS`（`gh pr merge` / `gh pr review` / `az repos pr set-vote`——**無非合併用途**才進這張表）、`SPEX_PROTECTED_BRANCHES`（同步自 rules 的 Branch Policy）、`SPEX_LEGACY_PR_ASK_RULES`（v0.8.0 舊規則，**只用於清理**，`install()` 與 `uninstall()` 都會呼叫 `removeLegacyPrAskPermissions` 把它們從既有安裝移除）。

兩層互補、分工明確：

- **`permissions.deny`**（字面層）：由 `ensureDenyRules(cwd, rules, label, log)` / `removeDenyRules` 這對共用 helper 寫入，繞過防護與合併防護各呼叫一次——它們同住 `permissions.deny` 陣列但所有權清單各自獨立。
- **`spex-merge-guard.sh`**（PreToolUse，exit 2）：擋 deny 表達不了的那些——MCP 的 `update_pull_request` 帶 `status: completed` 或 autoComplete 家族（同一工具也用來改 title，工具層粒度分不出）、`az repos pr update --status completed`、`git push` 到保護分支（含 `--all` / `--mirror`；解析 refspec，無 refspec 則讀當前分支）。

⚠️ **`git push` 絕不可進 deny 清單**——推 feature 分支是 `spex-pull-request` 的必經步驟，封整條會讓開 PR 跑不動。同理 `az repos pr update` 也不進 deny（改 title/description 是正常用途），只能靠 hook 逐引數判定。

hook 註冊改用共用 helper `ensureSpexHook(cwd, {command, owned, matcher, label}, log)` / `removeSpexHook(cwd, owned, log)`，章戳硬閘與合併硬閘各呼叫一次；三態邏輯（同 command 冪等／其他 owned 變體就地替換／否則 append）見「章戳鏈」段。

Copilot 只有 `terminal.denyList` 字面層（`COPILOT_DENY_KEYS` 併了繞過與合併兩組），Codex 連 denylist 都沒有——兩者 install 時各印一行誠實標註，說明 MCP 參數層與 `git push` 擋不到。政策章節在 `assets/rules/sdd-workflow.md` 的 `## PR 合併控管`（治理必備，客製時不可刪）。改清單只改 `base.ts` 一處。

Codex 讀本檔時注意：本節描述的 hook 與 `permissions.*` 皆為 Claude Code 專屬落點，Codex 環境沒有等價機制。

## MCP-only 繞過防護（中層，三 agent 落地）

防 AI 略過受控 MCP/TRACKER 直打底層 API/CLI。**單一來源**為 `base.ts` 的 `SPEX_BYPASS_COMMANDS`（`curl` / `wget` / `az boards` / `gh api`），各 installer 翻譯成原生格式：Claude Code → `permissions.deny`（`ensureBypassDeny` / `removeBypassDeny`，完全鏡射 PR-ask 那對函式的 merge/冪等/.bak/所有權清單邏輯，衍生清單 `SPEX_BYPASS_DENY_RULES = Bash(<cmd>:*)`）；Copilot → `.vscode/settings.json` 的 `github.copilot.chat.agent.terminal.denyList`（`ensureCopilotDenyList`，多字指令用 regex 鍵）；Codex → `.codex/config.toml` 的 `sandbox_mode` + `approval_policy`（`ensureCodexSandbox`，top-level key prepend 確保在任何 `[table]` 之前、已存在即略過不覆寫）。刻意**不**封 `az repos pr create` / `gh pr create`（開 PR 屬一般流程）；**合併**管道另有專屬 deny 與 hook，見上節。**這是中層**：對 compound/wrapper/env-var 變體脆弱。Claude Code 的 `PreToolUse` exit-2 硬擋**已在章戳鏈落地**（`spex-stamp-guard.sh` 守章戳鏈、`spex-merge-guard.sh` 守 PR 合併控管），但兩支都**未涵蓋本節的繞過指令家族**；把繞過封鎖也移進 hook 屬另案，且僅 Claude Code 具該能力。政策章節在 `assets/rules/sdd-workflow.md` 的 `## MCP-only`（含三 agent 不等價的誠實標註）。改清單只改 `SPEX_BYPASS_COMMANDS` 一處。

## 教訓閉環（lessons-learned loop）

讓 SDD 流程的失敗變成跟著 repo 走、可取回、可升級的持久記憶（Capture → Distill → Recall → Promote → Prune），補上「同一類錯誤反覆犯」的可靠度缺口。**格式單一來源** `assets/reference/spex/lessons-template.md`（隨 reference 機制安裝）；**治理單一來源** `assets/rules/sdd-workflow.md` 的 `## 教訓回收與升級`。教訓檔落地目標專案 `.claude/lessons/`（`L-<seq>.md` + `INDEX.md`，**必須 commit、禁止 gitignore**，目錄 on-demand）。接點：Capture 在 selfcheck Phase 4 Fail / implement F.4 Fail / schedule human-feedback；Recall 在 selfcheck・implement・schedule・plan・task 五個 skill 的「規則載入與記憶快取」前導段；Promote（`recurrence ≥ 2`）由 skill **主編排者**（非獨立驗證者）提案、人工確認後升級為硬防護。路徑 `.claude/lessons/` 由 `to-copilot-prompt.ts` 的 `rewriteClaudePaths` 改寫成 `.spex/lessons/`、Codex 由 `codex.ts` 的 `rewriteClaudePaths` 改寫成 `.codex/lessons/`。**鐵則**：獨立驗證者不背 Capture/Promote；`TRACKER.createPullRequest` 不因升級旁路。

## Rules（專案規則）— 取代手改 AGENTS.md

`assets/rules/*.md`（`sdd-workflow` / `commands` / `testing`）是安裝到目標專案的**專案設定**，取代過去要使用者手寫進 `AGENTS.md` 的章節，安裝後由專案**直接手動編輯維護**（無產生器 skill）。`sdd-workflow.md` 含治理必備章節 `## PR 開立控管` 與 `## Fail 判定`（客製時不可刪除）；架構（Layers / 路徑映射）與 File Zones 等專案特定章節由使用者自行補進此檔。skills 採**執行時讀規則檔**——Claude Code 的主代理靠原生機制自動載入 `.claude/rules/`，但子代理不繼承；**Codex 無此自動載入機制**，一律由 skill 執行時主動讀取，故 skill 內以「依 adapters/README 的 grep+offset SOP 讀 `.codex/rules/<file>.md` 對應章節（grep 不到 → fallback 整檔）」指令為準，並把探索結果快取進 memory（`type: project`）。**測試 / E2E 工具由 `rules/testing.md` 單一決定**（不寫死 Playwright）。skill body 一律用 `.codex/rules/...` 路徑（由 `codex.ts` 把來源的 `.claude/rules/...` 改寫成 `.codex/rules/...`），Copilot 安裝時則由 `to-copilot-prompt.ts` 改寫成 `.spex/rules/...`。

**規則 scope 到指定 skill（避免污染無關工作）**：每個規則檔的 frontmatter 以 `skills:` 宣告所屬的 skill（tool-neutral 單一來源），不再寫死檔案 glob。安裝時由各 installer **動態翻譯**成各工具的原生 scope：Claude Code → `.claude/rules/` 的 `paths:`（指向各 skill 的 `SKILL.md`，由 `claude-code.ts` 的 `renderRuleForClaude` 產生）；Copilot → `.github/instructions/<rule>.instructions.md` 的 `applyTo:`（指向 `.github/prompts/<name>.prompt.md`，由 `to-copilot-prompt.ts` 的 `skillsToApplyTo` 產生）；Codex → 規則檔頂部 HTML 註解標示所屬 skill（無自動 scope）。共用 helper `getRuleSkills(frontmatter)` 在 `base.ts`。如此這些 spex 專屬規則只在對應 skill 的脈絡相關，不會在使用者讀一般原始碼時被自動載入。注意：Claude Code 的 `paths:` 觸發是「讀到符合 glob 的檔案」，指向 `SKILL.md` 對「skill 被呼叫」不保證自動載入，可靠性仍靠 skill body 的 runtime-read（子代理與 Codex 本就如此，Codex 完全不具自動 scope 機制）。

## 新增一個 agent（如 Cursor）

1. 新增 `src/installers/<name>.ts`，實作 `AgentInstaller` 介面，檔尾 `registerInstaller(...)`。
2. 在 `src/commands/init.ts`、`uninstall.ts`、`mcp.ts` 補一行 side-effect import（registry 靠 import 才會被填充）。新 installer 必須實作 `AgentInstaller.uninstall(ctx)`，否則無法被 `spex uninstall` 解除安裝。
3. 處理 `ctx.mode`：資產過濾與段落剝除已在上游做完，installer 只需決定「有沒有 hook 機制」。有的話依 `mode` 選 hook 變體（比照 `claude-code.ts` 的 `SPEX_STAMP_HOOK_COMMANDS`）；沒有的話在 `mode === 'sandbox'` 時輸出一行誠實標註（比照 Copilot / Codex），不得讓使用者以為裝了等價防護。

主流程（commands）不需要其他改動。

## 不可違反的鐵則：token 絕不落檔

機密（PAT / API key）一律以 `${VAR}` / `${env:VAR}` 佔位寫進設定檔，實際值由使用者放在 shell 環境（`~/.zshrc`）或 CI Secret。**禁止**在專案內建立 `.env`、`.env.local` 或任何含明文 token 的檔案——即使加進 `.gitignore` 也違反政策。`mcp setup` 跑完只會「列出」缺哪些環境變數並印 `echo … >> ~/.zshrc` 指令，不會代寫。

## 慣例

- ESM 專案（`"type": "module"`）。TS 相對 import 一律帶 `.js` 副檔名（指向編譯產物），例如 `from './commands/init.js'`。
- TypeScript strict mode；避免 `any`。
- **註解、文件、CLI 輸出、commit message 用繁體中文**；程式識別字（function / variable / type）用英文。
- Commit message 遵循 Conventional Commits：`type(scope): 繁中描述`。
