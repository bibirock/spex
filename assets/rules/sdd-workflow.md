---
skills:
  - spex-write-spec
  - spex-plan
  - spex-task
  - spex-implement
  - spex-selfcheck
  - spex-pull-request
  - spex-schedule
  - spex-fixbug
  - spex-challenge
  - spex-stamp
  - spex-relay-init
  - commit-message
  - create-adapter
---

# SDD Workflow 規則

> - `commands.md` — 驗證指令束
> - `testing.md` — 測試 / E2E 工具
> - `reference/adapters/<id>.md` — tracker / 外部系統實作細節

---

## 核心原則

### 1. MVP 優先 — 禁止功能延伸

只實作目前 User Story **明確文字描述**的部分。

- ✅ 不預先抽象 / 不預留擴充點
- ✅ 發現「以後可能會用到」？→ 立刻刪除，建立新 Story
- ❌ 禁止「順便」修改不在範圍內的相關代碼
- ❌ 禁止因為「更好的設計」而重構未被要求的部分

### 2. 可測試優先

所有業務邏輯必須可被測試，目標覆蓋率 = 95%。

- ✅ UI 邏輯與展示邏輯分離
- ✅ 外部依賴可 mock
- ✅ 邊界條件有專用測試

### 3. 型別安全

TypeScript strict mode；避免裸 `any`、`@ts-ignore`。專案另有 conventions 規則時以該檔為準。

---

## ⛔ 嚴格禁止：功能延伸與幻想

> 本章節為最高優先級規則，凌駕其他原則。

### 禁止清單

| 行為             | 例子                                                 | 後果          |
| ---------------- | ---------------------------------------------------- | ------------- |
| 推斷性實作       | Story 要求「顯示節點名稱」→ 順便加上「編輯」         | 立即回滾      |
| 預防性抽象       | 為一個 `if/else` 建 Strategy Pattern「以後可能擴展」 | 立即刪除      |
| 善意重構         | 修 Bug 時順手重構旁邊的函式                          | 分離成獨立 PR |
| 假設性需求       | 「用戶應該會需要分頁，先做好」                       | 建立新 Story  |
| 超範圍優化       | Story 未要求效能優化卻加 memoization                 | 立即刪除      |
| 未授權的 UI 改動 | 修 Bug 時順便調整不相關的樣式                        | 分離成獨立 PR |

### 遇到模糊需求

1. 停止實作
2. 向使用者提問釐清（疑點不限數量、不設最小；每題符合問題品質三條件）；規格缺漏嚴重 → 建議先跑 `spex-write-spec` 補規格
3. 獲得明確確認後才繼續

### 發現範圍外問題

- 範圍外 Bug → 建立新 Bug Story
- 可優化代碼 → 建立 Tech Debt Story
- 設計問題 → 在 PR 描述中記錄，不擅自重構

---

## Tracker Adapter（唯一來源）

- **Tracker Adapter: `ado`** ← spex 系列 skill 啟動時直接從本行讀取。

可選值由 `.claude/reference/adapters/` 下實際存在的 adapter 文件決定（例如 `ado`、`local-file`）。
切換 adapter **只需改本行**；不可改用 memory、不可在 skill 內 hardcode。新增 adapter 走 `/create-adapter`。

---

## Branch Naming

分支前綴由目前生效的 Tracker Adapter 決定（見對應 `.claude/reference/adapters/<id>.md` 文件開頭的「分支前綴」宣告；例：ADO adapter → `ADO-`）。切換 adapter 時分支前綴隨之改變，不可假設固定為 `ADO-`。

Branch：

```
<type>/<TRACKER_PREFIX>-<id>-<kebab-case-summary>
# type: feature | fix | chore | refactor
# <TRACKER_PREFIX> 依當前 adapter 決定，見上；ADO adapter 範例：feature/ADO-1234-add-example-feature
```

驗證 regex：`^(feature|fix|chore|refactor)/ADO-<id>-`

### 排程批次共用分支（spex-schedule 專用）

`spex-schedule` 自動執行時**不**逐卡建分支，而是在批次啟動時從 base 分支（dev / develop / development）切出**單一共用分支**，整批所有卡片都在此分支上實作，批次結束後合併為**一個** PR。

```
chore/schedule-<YYYYMMDD-HHmm>
# 範例：chore/schedule-20260613-1430
# 時間戳到「分」→ 同一天可多批、各自獨立分支
# 中斷續行：不以日期重推名稱，改從 tracker 批次分支留言記錄的分支名沿用（見下）
```

驗證 regex：`^chore/schedule-\d{8}-\d{4}$`

> **續行 / 重跑的分支判定**：每個批次的共用分支名在啟動時產生一次、寫入 **tracker 批次分支留言**（`## [Spex] Schedule 批次分支`，記於凍結清單錨點卡）。中斷後續行或 redrive **同一批次** → 從 tracker 讀回該留言沿用原分支（不另開）；**全新批次** → 產生新時間戳分支並寫入留言。不可用「今天的日期」反推分支名（同日多批會撞名）。進度持久化只在 tracker，後續者 / 換手者只憑 tracker 即可接續，不依賴任何本機檔案。

批次模式下，這條共用分支即各 per-card skill（plan / task / implement / selfcheck / pull-request）分支驗證的**合法分支**——它們不再要求 `ADO-<id>` 格式；卡片 ID 改由 schedule 逐卡呼叫時的脈絡提供（**不**從分支名解析）。

---

## Branch Policy

- 不可直接 commit / merge 到 `master` 或 `main`。
- PR 目標分支須為 `dev` / `develop` / `development` 之一。
- 實作一律在 feature 分支（`feature/*`、`fix/*`、`chore/*` 等）。
- 驗證前先正規化分支名（去掉 `refs/heads/`，再以小寫比對）。
- 目標分支違反政策 → 停止並要求改用合規分支。

---

## 分支生命週期

命名規則見上方「Branch Naming」。驗證 regex：`^(feature|fix|chore|refactor)/ADO-<id>-`。

### 建立與驗證階段

| 階段                                     | 動作                                                |
| ---------------------------------------- | --------------------------------------------------- |
| `spex-plan` Phase 2.6 分類確認後   | 呼叫 `TRACKER.ensureBranch({ id, type, summary })`  |
| `spex-fixbug` Phase 1.3            | 驗證 `git branch --show-current` 符合本檔「Branch」 |
| `spex-task` Phase 0 / Phase 1      | 驗證 `git branch --show-current` 符合本檔「Branch」 |
| `spex-implement` Phase 0 / Phase 1 | 驗證 `git branch --show-current` 符合本檔「Branch」 |
| `spex-selfcheck` Phase 0           | 驗證 `git branch --show-current` 符合本檔「Branch」 |
| `spex-pull-request` Phase 1        | 驗證 `git branch --show-current` 符合本檔「Branch」 |

### 違規處置

- 不在預期分支 → 停止流程，提示使用者切回或回 `spex-plan` Phase 2.6 重建
- 禁止自動 `git checkout`
- ID 不符 regex → 視為人工建立分支，由使用者決定改名或建立新分支

### 排程批次例外（spex-schedule 自動執行）

`spex-schedule` 採**單一共用分支**模型（取代逐卡建分支 / 逐卡 PR）：

| 時點                                            | 動作                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 批次啟動（schedule Phase 1）                    | `git status --short` 乾淨 → 全新批次：產生時間戳分支 `chore/schedule-<YYYYMMDD-HHmm>` 從 base 切出並寫入 tracker 批次分支留言；續行 / redrive：從 tracker 讀回批次分支留言沿用原分支（見「Branch Naming › 排程批次共用分支」） |
| 逐卡推進（plan / task / implement / selfcheck） | 全部在共用分支上進行；plan Phase 2.6 `ensureBranch` **不建立**逐卡分支（偵測已在共用分支 → no-op）；卡片之間**不切回 base**（持續留在共用分支）                                                                                |
| 批次結束（schedule Phase 4 對帳通過後）         | schedule 呼叫 `spex-pull-request`（批次最終模式）對共用分支 → base 開**一個** PR，涵蓋全批卡片的 work items                                                                                                              |

- 批次啟動的 `git checkout -b <共用分支>`（或續行時 `git checkout <共用分支>`）屬合規操作，不受「禁止自動 git checkout」限制；前提：`git status --short` 乾淨，不乾淨 → 停止請使用者處理，不可硬切。
- 共用分支不符 per-card `ADO-<id>` regex 屬正常；批次模式下各 skill 以「排程批次共用分支」regex 驗證，卡片 ID 由 schedule 逐卡脈絡提供，不從分支名解析。

---

## Definition of Done

PR 合併前必須 100% 通過：

### 流程（必須）

- [ ] Tier 已判定（由 `spex-plan` Phase 2 分類判定）
- [ ] Tier 2 已執行完整 SDD（plan → task → implement → selfcheck → pull-request）
- [ ] 分支符合本檔「Branch Naming」與「Branch Policy」
- [ ] 規格已依 spec-template 寫入 work item description

### 可靠度防錯（必須，由 selfcheck / pull-request 把關）

- [ ] 最新 Verify 留言為 PASS（`spex-selfcheck` 獨立驗收通過，為開 PR 前置）
- [ ] 章戳鏈完整：Task／Implement 留言各帶有效 challenge 章、Verify 留言帶驗收章，且 `spex-stamp` 驗章 exit 0（無事件流環境須誠實標注「無章可驗」，不得宣稱通過）
- [ ] AC 覆蓋：每條編號 AC 對映至少一個可執行驗證並附證據
- [ ] 規格全覆蓋：除編號 AC 外，spec 的 In Scope 條列與「邊界條件」表逐項亦對映可執行驗證並附證據；任一未實作即 Fail（防「編號 AC 全過、In-Scope/邊界項漏做」型 Done 誤判）
- [ ] 列舉完整性：成組項目已 grep 全 codebase 勾稽、無遺漏成員
- [ ] 測試未弱化：測試檔變更未刪斷言、未放寬條件、未 skip（對應 selfcheck 防錯檢核 D；防「改測試讓它過」型假綠）
- [ ] PR 稽核：PR 由 `spex-pull-request` 開立且稽核留言完整
- [ ] 不存在未解決的 Verify Fail

### 範圍控制（必須）

- [ ] 本 PR 所有改動均在 Story 明確要求範圍內
- [ ] 無「順便修改」的無關代碼
- [ ] 若發現範圍外問題，已建立獨立 Story/Issue 記錄

### 代碼質量（必須）

- [ ] 驗證指令束全綠（見 `.claude/rules/commands.md`）
- [ ] 無 `console.log` 或 `debugger`
- [ ] 無 `// TODO: 強型別化` 的裸 `any`、無 `@ts-ignore`

### 測試覆蓋（必須）

- [ ] 新增測試檔案（與源檔案 1:1 對應）
- [ ] 測試覆蓋率 ≥ 80%
- [ ] 涵蓋 Happy path + Edge cases + Error paths

---

## PR 開立控管

1. **唯一入口**：`TRACKER.createPullRequest` 只允許由 `spex-pull-request` skill 的 Phase 4 呼叫；implement / schedule / 其他任何流程一律禁止直接開 PR。schedule 批次結束時的 PR 由 schedule **呼叫** `spex-pull-request`（批次最終模式）開立——`createPullRequest` 仍由 pull-request 呼叫，唯一入口不變；schedule 自身仍禁止直接呼叫。
2. **前置條件**：最新一筆 Verify 留言為 PASS（`spex-selfcheck` 獨立驗收）；PASS 後分支有新 commit → 須重新驗收。
3. **禁止 autoComplete**：`autoComplete` 一律 `false`；合併與工作項目完成由人類 reviewer 於平台 UI 操作。
4. **開立前查核**：檢查同分支 active PR；發現非本流程開立的 PR → 告警停止，交人工處置。
5. **人為介入點（雙路徑）**：
   - **互動確認（預設）**：展示完整 PR 內容（title / description / work items / reviewers），等使用者明確輸入「確認」/「ok」/「yes」。
   - **預授權**：使用者輸入含「**授權本次全自動開立 PR**」的明確語句（記錄原文 + 時間戳），僅該次任務鏈有效、不跨對話；模糊回覆（「都可以」「你決定」）不構成預授權；AI 不得自行補充或代答授權語句。
   - **批次預授權**（`spex-schedule` 收集）：語句必須明示批次（「**授權本批次全自動開立 PR**」）。新模型下整批共用一條分支、批次結束**只開一個** PR（涵蓋全批卡片的 work items），由 schedule 於對帳通過後呼叫 `spex-pull-request`（批次最終模式）開立；稽核留言寫入該 PR 涵蓋的**每張父卡**並引用同一原文與時間戳；批次結束即失效，重跑批次需重新授權。
6. **稽核留言（必寫）**：PR 開立後寫入父卡 `## [Spex] PullRequest 完成`，含模式（互動確認 / 預授權）、確認者輸入原文、時間戳、PR URL、技術防護狀態。
7. **技術層防護（Claude Code）**：spex 安裝時把開 PR 工具（`mcp__azure-devops__create_pull_request`、`az repos pr create`、`gh pr create`）寫入 `.claude/settings.json` 的 `permissions.ask`——互動 session 由使用者當下核准、headless 自動拒絕。移除規則或改為 allow 屬有意識的防護降級，pull-request skill 會在稽核留言標註 `degraded`。

---

## MCP-only（繞過管道封鎖）

> 核心命題：防止 AI 略過受控的 MCP/TRACKER、直接呼叫底層 API/CLI。**prompt 與 skill 指令不是 access control**——靠文字叫 AI「請走 MCP」沒有強制力；可靠作法是在權限／sandbox 層讓「繞過 MCP」這條路跑不起來。

1. **繞過指令家族**：`curl` / `wget`（raw HTTP）、`az boards`（ADO work item CLI）、`gh api`（GitHub API CLI）一律封鎖；這些是繞過 TRACKER 直打後端的主要管道。**單一來源**為 installer 的 `SPEX_BYPASS_COMMANDS`，改清單只改一處。
2. **不蓋 PR 逃生口**：刻意**不**封 `az repos pr create` / `gh pr create`——那兩條由 `permissions.ask` 走人工核准（見「PR 開立控管」§7），deny 不得蓋掉。
3. **各 agent 落地（強度不等價，誠實標註）**：
   - **Claude Code**：寫 `.claude/settings.json` 的 `permissions.deny`（由 harness 而非模型強制，優先序高於 ask/allow）。**最強的中層防護**。
   - **GitHub Copilot**：寫 `.vscode/settings.json` 的 `github.copilot.chat.agent.terminal.denyList`——**僅 VS Code agent 終端生效**；Copilot CLI / coding-agent 可能不讀。
   - **Codex**：寫 `.codex/config.toml` 的 `sandbox_mode = "workspace-write"` ＋ `approval_policy = "untrusted"`（封網路 egress→擋直打 REST）；**粒度較粗、無逐指令 denylist**。
4. **殘餘缺口（本輪未補）**：deny / denyList / sandbox 屬**中層**防護，對 compound command（`x && curl …`）、wrapper、env-var 內插等變體脆弱。不可繞過的執行期硬擋（Claude Code `PreToolUse` hook，exit 2）為**另案**，尚未安裝；三 agent 中僅 Claude Code 具備該能力，Copilot / Codex 無對應。
5. **防護降級可稽核**：移除 deny / denyList、改 allow、關 sandbox 都算有意識的降級，須在當次任務鏈留痕。

---

## Fail 判定

> 檢核目標：系統**絕不能**把錯誤的實作結果判定為成功。

1. **驗證失敗不得 skip**：測試 / E2E / 驗證指令束失敗，經重試與外部知識查詢仍無法修復 → 判定 Fail（implement F.4）：寫 `## [Spex] Verify Fail` 留言、停止任務鏈；不存在「跳過失敗測試繼續流程」的路徑。
2. **失敗任務絕不轉 done**：任務狀態保持非 done，直到缺失修復並重新通過驗證。
3. **獨立驗收（selfcheck）**：implement 完成後必經 `spex-selfcheck`——確定性檢查（exit code）先行；全新上下文的獨立 AI 逐條 AC、In Scope 條列、邊界條件 二元判定並引用證據；**無證據 = Fail**（保守原則）。
4. **重做迴圈上限**：selfcheck 最多 3 輪驗收（2 次重做），超限升級人工；AC 模糊不可測、同條 AC verdict 兩輪翻覆、高風險變更（migration / 安全 / 不可逆）→ 立即升級人工。
5. **存在 Verify Fail → 禁止開 PR**（`spex-pull-request` Phase 1 Gate 強制）。
6. **驗章失敗等同 Fail**：`spex-stamp` exit ≠ 0 → 不得寫留言、不得交棒、不得開 PR；不得以「留言看起來完整」或「驗證者說 PASS」放行（見「章戳鏈」）。
7. **缺口層級決定路由**（selfcheck 防錯檢核 E）：`實作漏` → 回 `spex-implement`；`拆卡漏` → 回 `spex-task` 補卡並重取章；`spec 漏` → 立即升級人工（規格問題重做解不了）。

---

## 對抗式詰問

> 核心命題：**做事的人不能自評**。每個階段的產出在寫進 tracker 或交棒前，先由一個全新上下文、唯讀、立場敵對的 `challenger` 逐項詰問；未過不得交棒。執行協定見 `.claude/skills/spex-challenge/SKILL.md`。

- **詰問輪次上限（唯一來源，調整只改本行）：3**（含首輪，＝2 次重詰）。第 3 輪仍 FAIL → 停止並升級人工；**此上限由驗章器程式碼硬執行**（宣稱輪次超限或同 stage 章數超限 → 產物一律無效），第 4 輪起即使 challenger 回 PASS 也不放行。
- **詰問接點範圍（唯一來源）：`task`（子卡建立前）、`implement`（Implement 完成留言寫入前）**。`selfcheck` 走 `verifier` 的獨立驗收章，不在 challenge 範圍；`plan` / `fixbug` 目前不設接點。
- **判準錨定**：blocking FAIL 必須錨定「卡片規格原文」或「可靠性判準」（假證據／假綠／範圍外變更／隔離破口）二者之一；無法錨定者一律 non-blocking。防止詰問淪為無限追問與過度設計壓力。
- **verdict 不可改判**：PASS 的唯一證據＝最後一輪 challenger 原文輸出整體 PASS。呼叫階段不得以「修正已納入」「FAIL 數下降」等理由自行宣告 PASS。
- **確定性先行**：進詰問前先跑 `.claude/reference/spex/scripts/task-draft-lint.mjs`（task 接點）等機器檢查，別讓 challenger 燒在格式問題上。

---

## 章戳鏈（蓋章 / 驗章）

> 核心命題：**留言怎麼寫都不算數**。交棒憑證不是一句「PASS」，而是一枚由 harness 生成、執行者無法鑄造的章；下游一律以程式重驗，不信任文字。

### 信任模型

| 元件 | 實體 | 不可仿冒性質 |
|---|---|---|
| 蓋章者 | `challenger` / `verifier` subagent（`.claude/agents/`） | 全新上下文、唯讀 |
| 章號 | Agent 派發事件的 `tool_use_id`（`toolu_…`）或回傳的 `agentId` | harness 生成，模型無法鑄造、天然不重複 |
| 章面 | 子代理輸出末行 `[CHALLENGE-VERDICT …]` / `[VERIFIER-VERDICT …]` | 位於子代理事件內，主 agent 的文字偽造不進去 |
| 載體 | 事件流，**一律在目標 repo 之外**（沙盒＝host 影子流；Claude Code＝`~/.claude/projects/`） | 執行者寫不到（沙盒）／受 PreToolUse 硬閘保護（Claude Code） |
| 內容綁定 | 章面 `sha256`（NFC → 空白摺疊 → trim → 前 16 hex） | 舊章蓋不了改過的內容（防重放） |
| 消耗帳 | 一章一用 | 用過的章不能支持第二個宣稱 |

### 不變式（由 `challenge-audit.py` 程式硬執行）

`S0` 詰問前須載入 `spex-challenge`；`S1` 宣稱須引存在且已完成的章號；`S2` 章面為結構化 PASS，且該 stage 最新章必須收斂到 PASS（**FAIL 不蓋章**）；`S3` 輪次相符且不超限；`S4` 同 stage 章數不超限；`S5` 章面 sha256 與留言本體綁定；`S6` 一章一用；`S7` Verify 留言須引 verifier 章；`S8` 章面含 sha256 時子代理軌跡內須有真實雜湊計算；`I3` 詰問一律同步派發。

### 鐵則

1. **驗章者＝程式**：一律由 `.claude/skills/spex-stamp/SKILL.md` 呼叫 `challenge-audit.py` 裁定。**exit ≠ 0 → 不得寫留言、不得交棒、不得開 PR**；結果不可被 LLM 改判。
2. **自書章行＝偽造**：執行者絕對禁止自行補寫章面、自算 sha256、或以「內容看起來通過」推斷 PASS。事件層驗章會識破，該接點全作廢並記做假訊號。
3. **蓋章後不得潤飾**：留言本體必須逐字等於受審圍欄，唯一允許的差異是追加引章宣稱行。改一個字內容綁定就失效。
4. **真實子卡 ID 不進蓋章本體**：ID 在開卡後才存在，混進本體會使章綁不到最終留言；ID 事實走獨立留言，可由 `getDependencies` 直接重新推導。

### 章的強度分層（誠實標註，三 agent 不等價）

| 強度 | 環境 | 機制 | 邊界 |
|---|---|---|---|
| 最強 | 沙盒（`spex-sandbox-init`） | 影子流由 host tee 到掛載區之外，容器**物理寫不到** | Docker 非硬安全邊界（共享 kernel） |
| 中 | Claude Code（非沙盒） | 事件流由 harness 寫在 `~/.claude/projects/`；PreToolUse 硬閘（`spex-stamp-guard.sh`）擋下未驗章的 tracker 寫入與對事件流的改寫 | hook 的 Bash 比對是字面解析，對 compound／wrapper 變體不完備 |
| 無 | Codex / Copilot | 無 subagent 註冊機制、無事件流 → **沒有可驗的章** | 只剩 `task-draft-lint` 的確定性檢查；文件不得宣稱這裡有章 |

移除 hook、改用掛載區鏡像充當影子流、關閉沙盒，皆屬**有意識的防護降級**，須在當次任務鏈留痕。

---

## 教訓回收與升級

> 目標：讓**同一類錯誤不再反覆犯**。每次 Fail 不只是當下擋下，還要萃取成跟著 repo 走的持久教訓；反覆到門檻就升級為**確定性硬防護**（不依賴模型自律）。格式單一來源見 `.claude/reference/spex/lessons-template.md`。

1. **教訓檔位置**：目標專案 `.claude/lessons/`（`L-<seq>.md` ＋ `INDEX.md`）——**必須 commit、禁止寫進 `.gitignore`**；目錄 on-demand（首次寫教訓時才 `mkdir`）。Copilot 落地 `.spex/lessons/`、Codex `.codex/lessons/`。
2. **Capture（捕捉）**：以下三個接點在寫 tracker 留言的**同時**萃取一則結構化教訓（症狀／根因／防護／升級狀態）：
   - `spex-selfcheck` Phase 4 任一 Fail（`trigger: selfcheck-fail`）
   - `spex-implement` F.4 判定 Fail（`trigger: implement-f4`）
   - `spex-schedule` 互動確認被使用者糾正（`trigger: human-feedback`）
3. **Distill（萃取/去重）**：寫入前 grep `INDEX.md` 比對症狀＋根因；命中 → `recurrence+1`、更新 `lastSeen`，**不新增**；否則新建 `L-<seq>.md` 並補一列索引。避免記憶膨脹與雜訊。
4. **Recall（取回）**：各 SDD skill 啟動的「規則載入與記憶快取」前導段，多一步 grep `.claude/lessons/INDEX.md` 取 `skills:` 命中本 skill 的 `active` 教訓，把其「防護」納入本輪注意事項。**scope 到相關 skill 才不污染無關工作。**
5. **Promote（升級）**：教訓 `recurrence ≥ 2` → 由 skill **主編排者**（**非**獨立驗證者）提案升級為 T2 確定性硬防護（selfcheck 防錯檢核項／本檔「歷史教訓」／迴歸測試），**人工確認後**寫入並把教訓標 `status: promoted`。真正讓再犯率趨近 0 的是這一步。
6. **Prune（修剪）**：Recall 時若教訓引用的檔／旗標已不存在 → 標 `status: retired`，不再注入，避免 stale 記憶誤導。
7. **鐵則**：
   - **獨立驗證者不背 Capture / Promote 職責**——驗證者只讀證據、不改 code、不升級規則（守住「驗證與修正分離」）；Capture / Promote 由各 skill 的主編排者負責。
   - Promote 寫入硬防護仍受既有控管：改 `sdd-workflow.md` 治理章節、開 PR 等一律走原流程，`TRACKER.createPullRequest` 不因升級而旁路。

---

## 程式碼導航策略（LSP 優先）

> SDD 流程涉及「找定義 / 找呼叫者 / 查型別 / 看符號」時，**優先使用 LSP（Language Server Protocol）**，避免全文 grep 造成的不精確結果與雜訊噪音。

### 工具優先序

1. **LSP** — 跳到定義、找參考、型別簽名、符號重命名
2. **grep / glob** — 找字串樣式、註解、檔名 pattern；LSP 不可用時 fallback

### 對照表

| 任務                                   | 建議工具                                 |
| -------------------------------------- | ---------------------------------------- |
| 跳到函式 / 變數 / 型別定義             | LSP `textDocument/definition`            |
| 找所有呼叫點與引用                     | LSP `textDocument/references`            |
| 查型別簽名與 hover 資訊                | LSP `textDocument/hover`                 |
| 找符號（檔內 / 工作區）                | LSP `documentSymbol` / `workspaceSymbol` |
| 找錯誤訊息字串、註解 keyword、檔名樣式 | grep / glob                              |

### 環境檢查

進入需要程式碼導航的 phase（plan Phase 4 / fixbug Phase 3 / implement subagent 探索）前：

1. 偵測 LSP 是否可用：
   - **Claude Code with IDE**：使用 IDE 整合提供的 LSP 通道（如 VS Code / JetBrains extension）
   - **Claude Code CLI（無 IDE）**：使用已安裝的 LSP MCP server（例：Serena MCP 等第三方 LSP 包裝）
2. **可用** → 走 LSP
3. **不可用** → 顯示下方安裝提示後，fallback 到 grep / glob；於 plan 報告 / fixbug 報告中標註「LSP 不可用，分析以 grep fallback 進行，精度可能下降」

### LSP 不可用時跳過，不強制安裝；但建議使用者安裝以提升精度與效率。

---

## 多 Repo 執行紀律

> 任務涉及多個 repo（前後端分離等）時，shell 的 `cd` 會殘留到後續指令，是跑錯目錄的最大來源。

- **一律帶絕對路徑**：git 用 `git -C <repo絕對路徑>`；npm 用 `npm --prefix <repo絕對路徑> run <script>`，或在**同一次** shell 呼叫內 `cd <repo絕對路徑> && <指令>`（不可依賴前一次呼叫的 cd）
- 驗證指令束執行前先 `pwd` 比對目標 repo；輸出異常（missing script、no tests）先懷疑目錄錯誤再懷疑程式
- 各 repo 的驗證指令束、分支操作分開執行、分開確認結果；禁止一條指令鏈混跨兩個 repo 的驗證
- commands.md 應記錄各 repo 根目錄絕對路徑（見其範本欄位）

---

## spex-schedule 批次模式互動確認規則

0. **起跑序：`/plan`（必經）→ 執行驅動（規範）**：批次一律**先在 plan 模式**（唯讀）完成 Phase 0–2「盤點看板（對話呈現，不落檔）+ 分類確認 + 收集批次授權（含『授權本批次全自動開立 PR』）」，經使用者核准計畫（ExitPlanMode）後，再進入執行驅動跑 Phase 2.5 起的實作鏈。執行驅動**三選一**（並列，非漸進）：**手動**（小批次、估計一個 context 跑得完 → plan 核准後直接跑即可，**不需 goal**）、**/goal**（大批次 / 要無人值守跑到完 → 跨壓縮存活 + 收斂驗證 + turn 上限）、**/loop**（卡片常等外部事件）。**第一個寫入動作（建分支 / 寫檔 / 動 tracker）一律在離開 plan 模式之後**；未經 /plan 盤點與授權不得直接進執行。
1. **授權記錄**：批次啟動時必須記錄使用者授權原文 + 時間戳；各 skill 引用該記錄，不得自行補充授權範圍。
2. **階段性寫入**（留言 / 子卡 / 任務狀態）：不展示，寫入留言即可。
3. **分類 / 拆卡確認點**（plan Phase 2、task Phase 5.3）：展示後直接續行；但分類含「降 Tier」或「缺陷規模降級」時不可自行決定 → 標 blocked。
4. **疑點處理**：無人可答 → 上網查找與推理最佳解法、不暫停；該卡標 blocked，疑點清單寫入卡片留言，繼續下一步，並於後續 PR 時以粗體重點提醒。
5. **終態回報**：每卡達終態（done / blocked）必寫收尾留言，引用授權記錄，**沒有獲得使用者批準自動開 PR 就不自動開，需等確認才能繼續**。

---

## 批次進度持久化規則（spex-schedule）

- **唯一事實來源 = tracker**：批次進度由各卡 tracker 留言鏈每輪重新盤點推導（level-triggered），共用分支名存於 tracker 批次分支留言（見「Branch Naming › 排程批次共用分支」）。
- **不落任何本機檔案**：壓縮 / 換手 / 斷線後由下一輪重新盤點 tracker 自動還原，後續者只憑 tracker 即可接續，不受本機狀態限制。

---

## ID 事實鐵則

- Tracker item ID（含子卡編號）**必須由 tracker 讀回**（readItem / fetch），**禁止**依建卡順序、上一張卡編號、分支名推斷。歷史教訓：自動編號可能被其他資料表 / 已刪項目占號，推斷必錯。
- commit 訊息、留言、分支名中引用的 ID 在寫入前須與 tracker 回讀值核對一次。
