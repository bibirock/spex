---
name: spex-selfcheck
description: 獨立驗收編排者。在 implement 完成後、開 PR 前，先跑確定性檢查（驗證指令束 + E2E），再派發全新上下文的獨立 AI 驗證者逐條 AC 對照 diff 與證據做二元判定；任一 Fail 即產出結構化重做清單退回 implement（最多 2 次重做，超限升級人工），全 PASS 才放行 spex-pull-request。前置：spex-implement。後續：spex-pull-request。
---

# Spex: Selfcheck — 獨立驗收

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 0 讀父卡 description（規格 / AC 來源） |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 0 取 Plan / Task / 上一輪 Verify 留言 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 4 寫 Verify 完成 / Verify Fail 留言 |

## 規則載入與記憶快取

啟動時依 adapters/README.md 的 grep+offset SOP 主動讀取（章節 grep 不到 → fallback 整檔讀）：

- `.claude/rules/sdd-workflow.md` — 「Branch Naming」「Fail 判定」「Definition of Done」「章戳鏈（蓋章 / 驗章）」章節；批次驅動時另讀「spex-schedule 批次模式互動確認規則」「多 Repo 執行紀律」「ID 事實鐵則」章節
- `.claude/rules/commands.md` — 整檔（驗證指令束唯一來源）
- `.claude/rules/testing.md` — 整檔（E2E 指令 / artifact 目錄唯一來源）

探索結果寫入 memory（`type: project`，檔名固定 `sdd-rules-cache.md`，同 key 更新不新增）供下次取用；與當前規則檔不符時以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-selfcheck` 的 `active` 教訓，讀其「防護」納入本輪驗收注意點（**僅供注意，不取代任一防錯檢核**）；若教訓引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

獨立驗收編排者。**唯一職責：判定 implement 的產出是否達成規格，PASS / FAIL 二擇一，且判定必須有證據。**

設計原則（防止「誤判成功」）：

1. **實作者不能自評**——無外部訊號的自我修正不可靠；驗收由全新上下文的獨立 Agent 執行，不沿用實作對話。
2. **先機器後模型**——確定性檢查（exit code）先行，任一失敗直接 Fail，不花 LLM 判讀。
3. **無證據 = Fail**——每條 AC 的 PASS 都要引用證據（測試名 / 檔案:行 / 輸出）；找不到證據就是 Fail，不是「沒看到問題所以過」。
4. **本 skill 永不修改程式碼**——發現問題只產出重做清單，修正是 implement 的事（做事的不打分，打分的不動手）。

## When to Use

- ✅ implement 已完成所有任務與父卡全流程驗證（Phase I）
- ✅ selfcheck Fail 重做後的再驗收
- ❌ 任務尚未全部完成 → 回 `spex-implement`
- ❌ 想開 PR → 先過本 skill，再 `spex-pull-request`

---

## Process

### Phase 0: 上下文與輪次判定

1. **分支驗證（強制最先）**：`git branch --show-current` 須符合 SDD workflow 規則「Branch Naming」；不符 → 停止。
2. 自分支名解析 tracker item ID（不符格式才詢問使用者）。
3. 取得驗收依據：
   - `TRACKER.readItem(id)` → description 內規格（spec-template 格式）：**驗收標準（AC）**、**邊界條件**、**列舉完整性清單**、Out of Scope
   - `TRACKER.findSpecComment(id, "Plan")` → 成功條件（量化）（Tier 1 無 Plan 留言則略過）
   - `TRACKER.findSpecComment(id, "Task")` → 各任務 AC
4. **輪次判定**：`TRACKER.findSpecComment(id, "Verify")`（回最新一筆）：

| 最新 Verify 留言 | 本輪輪次 |
|---|---|
| 不存在 | 第 1 輪 |
| `Verify Fail`（輪次 N） | 第 N+1 輪；**N+1 > 3 → 不執行驗收**，直接升級人工（見 Phase 4 升級規則） |
| `Verify 完成`（PASS） | 告知已通過；僅當其後有新 commit 才重新驗收（重置為第 1 輪） |

### Phase 1: 輸入打包

組裝驗收輸入（之後交給確定性檢查與獨立驗證者）：

- **AC 清單**：規格 AC + 邊界條件 + 列舉完整性清單 + Plan 量化成功條件 + 各任務 AC，統一編號
- **變更內容**：`git diff <targetBranch>...HEAD`（targetBranch 依 SDD workflow 規則「Branch Policy」解析：dev / develop / development）
- **測試檔變更清單**：diff 中測試檔（如 `*.spec.*` / `*.e2e.*`）的變更單獨列出（供測試弱化檢查）
- **驗證指令束**（commands 規則）與 **完整 E2E 指令**（testing 規則）

**鐵則：不得把實作過程的推理、自評、對話歷史放進驗收輸入。** 驗證者只能看到「規格、diff、機器證據」——這是獨立性的來源。

### Phase 2: 確定性 Gate（機器先行）

依序執行並**保留原始輸出與 exit code**：

1. 驗證指令束（commands 規則定義的完整序列）
2. 完整 E2E 指令（testing 規則；先依 commands 規則確認 dev server health check 通過）

判定規則：

- **任一指令 exit code ≠ 0 → 直接 Fail**，跳 Phase 4（不進獨立判讀，附原始輸出）
- **PASS_TO_PASS**：既有測試全綠（不得有因本次變更轉紅的舊測試）
- **FAIL_TO_PASS**：本任務鏈新增的測試存在且通過（對照 Task 留言的任務清單；無任何新增測試 → 在 Phase 3 交由驗證者判定 AC 覆蓋是否成立）
- E2E artifact 處理依 implement D.1 規則（驗收產生的執行產物不留進版控）

### Phase 3: 獨立 AI 判讀（全新上下文）

以**全新上下文**派發獨立驗證者：

| 環境 | 派發方式 | 章 |
|---|---|---|
| Claude Code | Task 工具派發 `subagent_type: verifier`（定義見 `.claude/agents/verifier.md`；獨立 context window，不繼承本對話） | 有（章號 = 派發事件 `tool_use_id` / 回傳 `agentId`） |
| Codex CLI | `codex exec` 非互動執行驗證 prompt（或開新對話貼入） | **無**（無事件流可驗，見「章的強度分層」） |
| Copilot | 開新 Chat 對話貼入驗證 prompt（無自動隔離機制） | **無** |

**同步鐵則**：必須同步等待驗證者回傳原文（`run_in_background: false`）；未取得原文前不得進 Phase 4。自行推測 / 代寫 verdict = 造假。

驗證者輸入**只有**：AC 清單、diff、Phase 2 的指令輸出證據，以及**任務卡內容**（`getDependencies` + `readItem` 讀回的 description / AC）與 Task 留言的規格勾稽資訊——後兩者屬**規格側工件**（規格如何被分解），送入前**必須剝除上游一切結論性文字**（`challenge：PASS` 宣稱行、處置欄、任何 verdict 措辭），避免驗證者繼承上游判斷。實作推理與對話歷史仍然禁止。

判定規則與輸出格式見 `.claude/agents/verifier.md`（單一來源）。派發 prompt **必須註明本卡的卡片編號**（＝父卡 tracker item ID，驗證者逐字抄進章面 `card=`；驗章器據此把收斂判定限縮在單張卡，批次跑多卡時才不會互相牽連）。派發 prompt 另指定本輪要跑的防錯檢核：

| 代號 | 檢核（逐項回報 PASS / FAIL + 證據） |
|---|---|
| A | **AC 覆蓋**：每條 AC 是否對應至少一個可執行驗證（測試或指令）且通過？格式相關 AC 是否有格式驗證？任一 AC 找不到對映證據 → 直接 FAIL，不得以「其餘 AC 都過」放行 |
| B | **列舉完整性**：規格「列舉完整性清單」的每個範圍內成員是否都在 diff 中被處理？用 grep 全 codebase 勾稽成員名稱，確認沒有遺漏的引用點 |
| C | **範圍外變更**：diff 是否含 Out of Scope 或與 AC 無關的變更（含 config / CI / 設定檔的非必要改動）？ |
| D | **測試弱化**：測試檔變更是否降低了斷言強度（刪斷言、放寬條件、skip）？ |
| E | **三向 traceability**：規格（AC ＋ In Scope 條列 ＋ 邊界條件 ＋ 列舉完整性）→ 任務卡 → diff 證據逐條勾稽。任一缺口 → FAIL，且**必須標明缺口層級**：`spec 漏`（規格本身沒定義）／`拆卡漏`（規格有但無對應任務卡）／`實作漏`（有卡但 diff 無證據）——層級決定重做路由 |
| F | **章戳驗證**：Task 留言與 Implement 完成留言是否各帶一個有效的 `challenge：PASS（…章 …）` 宣稱？（驗證者只確認宣稱**存在且格式正確**；真偽由主編排者在 Phase 4 以 `spex-stamp` 對事件流做確定性裁定，驗證者接觸不到事件流，**不得**以「章號無法查證」判 FAIL） |
| G | **任務卡未被靜默丟棄**：Task 留言列出的每個 `T-XXX` 是否都有對應子卡、且狀態為 `done` 或 `removed`？`removed` 需有理由留言，否則 FAIL |

**non-blocking 訊號**（寫進報告、不單獨判 Fail）：詰問輪次零疑點、或勾稽出現「未覆蓋」項 → 提高該範圍審查強度並於報告標注。

### Phase 4: 判定與路由

整體判定 = Phase 2 全綠 **且** Phase 3 整體 PASS **且** 章戳驗證通過。

**章戳驗證（主編排者執行，非驗證者）**：呼叫 `.claude/skills/spex-stamp/SKILL.md` 對事件流跑確定性稽核——涵蓋上游 Task／Implement 留言的 challenge 章（S1–S6、S8）與本輪 verifier 章（S5、S7、S8）。**exit ≠ 0 → 一律 Fail**，不得以「驗證者說 PASS」覆寫；無事件流的環境（Codex / Copilot）→ 於留言誠實標注「本環境無章可驗」，**不得宣稱驗章通過**。

**內容綁定鐵則**：驗收章的 sha256 綁定驗證者輸出的 `<!-- verify-report:start -->` … `<!-- verify-report:end -->` 區塊。Verify 留言必須**逐字內嵌整段（含前後標記）**——改一個字、把 FAIL 項改寫成 PASS、或自行重排 AC 對照表，內容綁定即失效，驗章 S5 必炸。**驗證者的判定文字不是素材，是受章保護的產物**；編排者只能在區塊之外補充自己的章節（確定性檢查、章戳驗證、下一步）。

#### 全 PASS

展示完整留言、經寫入前確認後寫入（本體不得於蓋章後潤飾）：

```
## [Spex] Verify 完成

> 輪次：第 <n> 輪 | 判定：PASS | 日期：<DATE>

### 確定性檢查
- 驗證指令束：全綠 | E2E：0 failed | PASS_TO_PASS / FAIL_TO_PASS：通過

<驗證者輸出的 verify-report 區塊，含前後標記逐字內嵌——內含 AC 對照表、防錯檢核 A–G、non-blocking 備註三節>

### 章戳驗證
<spex-stamp exit code 與稽核摘要；無事件流環境標注「本環境無章可驗」>

### 下一步
`spex-pull-request`

驗收章 <章號>
```

> 內嵌後的樣子（`<!-- … -->` 兩行是綁定範圍的界線，**必須保留**）：
>
> ```
> <!-- verify-report:start -->
> ### AC 對照表（traceability）
> …
> ### 防錯檢核
> …
> ### non-blocking 備註
> …
> <!-- verify-report:end -->
> ```

提示使用者：「獨立驗收通過，可執行 `/spex-pull-request` 開立 PR。」

#### 任一 Fail

留言建立收集到的錯誤清單，並提示使用者：「驗收未通過，請依照以下清單修正實作（最多 2 次重做，超限將升級人工）。」

重做清單每項須含**缺口層級 → 路由**：

| 缺口層級 | 路由 |
|---|---|
| `實作漏` | 回 `spex-implement` 依清單修正 → 重跑本 skill（第 n+1 輪） |
| `拆卡漏` | 回 `spex-task` 補卡（重跑其 Phase 4.5 詰問取新章）→ 再回 `spex-implement` → 重跑本 skill |
| `spec 漏` | **立即升級人工**（規格問題重做解不了），建議補跑 `spex-write-spec` |

後續：

- 重做的修正完成後**必須從 Phase 2 重跑**（機器證據要重新產生）
- 任務狀態**絕不**轉 `done`；不得進 `spex-pull-request`

#### 教訓捕捉與升級（Capture / Distill / Promote）

走「任一 Fail」路線時，於寫 Verify Fail 留言的**同時**，依 `.claude/reference/spex/lessons-template.md` 萃取一則教訓到 `.claude/lessons/`（`trigger: selfcheck-fail`）。此步由**本 skill 主編排者**負責，**獨立驗證者不參與**（守住「驗證者不改 code、不背升級職責」）：

1. **Capture / Distill**：首次先 `mkdir -p .claude/lessons/`；grep `INDEX.md` 比對本次「症狀＋根因」——命中 → 既有 `L-<seq>.md` 的 `recurrence+1`、更新 `lastSeen`，不新增；否則新建 `L-<seq>.md`（序號 = INDEX 現有最大值 +1）並補一列索引。`skills:` 至少含 `spex-selfcheck`（涉及實作面再加 `spex-implement`）。
2. **Promote（升級提案）**：若該教訓 `recurrence ≥ 2`，由主編排者提案升級為確定性硬防護（新增防錯檢核項／寫進 `sdd-workflow.md`「歷史教訓」／加迴歸測試），**展示提案經使用者確認後**才寫入並標 `status: promoted`；未獲確認不自行改規則。
3. 此步**不**改被測程式碼、**不**影響本輪 PASS/FAIL 判定（判定已定於上方），只負責持久記憶與升級提案。

#### 重做上限與升級人工

- **上限 3 輪驗收（= 最多 2 次重做）**。第 3 輪仍 Fail → 停止，升級人工：彙整歷輪 verdict 摘要 + 最終 diff 概要 + 未過項目，等待使用者決策，不再自動重做。
- **立即升級人工（不重做）**，任一成立：
  1. AC 本身模糊或不可二元判定（規格問題，重做解不了）→ 建議補跑 `spex-write-spec` 修規格
  2. 同一條 AC 在兩輪間 verdict 翻覆（PASS↔FAIL，判定不穩定訊號）
  3. 變更屬高風險類：migration / 安全與權限核心 / 不可逆操作

---

## Red Flags

- ❌ 驗證者自行修改程式碼（驗收與修正必須分離）
- ❌ 把實作推理 / 對話歷史餵給驗證者
- ❌ 無證據判 PASS（「看起來完成了」不是證據）
- ❌ 確定性檢查未跑或未附 exit code 就進獨立判讀
- ❌ Fail 後仍進 `spex-pull-request`
- ❌ 超過 3 輪仍自動重做
- ❌ 重做後未從 Phase 2 重跑、沿用舊機器證據
- ❌ 把 non-blocking 風格建議當成 Fail 理由（過度挑剔）
- ❌ 驗章 exit ≠ 0 卻以「驗證者說 PASS」放行（驗章結果不可被 LLM 覆寫）
- ❌ 在無事件流的環境宣稱「驗章通過」
- ❌ 把上游的 `challenge：PASS` 宣稱行或處置理由餵給驗證者（會繼承上游判斷）

## Verification

- [ ] Phase 0 已判定輪次；超限時未執行驗收直接升級人工
- [ ] Phase 1 驗收輸入不含實作推理 / 對話歷史
- [ ] Phase 2 指令全數執行且保留 exit code 與輸出
- [ ] Phase 3 以全新上下文派發（Claude Code 用 `subagent_type: verifier`）；每條 AC 有 verdict + 證據
- [ ] 防錯檢核 A–G 逐項有結果；E 已標缺口層級
- [ ] Phase 4 已跑 `spex-stamp` 驗章並記錄 exit code；無事件流環境已誠實標注
- [ ] PASS 留言含 `驗收章 <章號>`，且逐字內嵌驗證者的 `verify-report` 區塊（含前後標記，未經潤飾）；Fail 重做清單含缺口層級與路由
- [ ] Phase 4 留言已展示並經確認後寫入；Fail 時含結構化重做清單
- [ ] Fail 時已捕捉教訓到 `.claude/lessons/`（去重 / `recurrence` 已更新）；`recurrence ≥ 2` 已提出升級提案（由主編排者、非驗證者）

## Next Steps

- PASS → 經使用者確認後進入（全自動不用） `spex-pull-request`
- FAIL → `spex-implement`（依重做清單）→ 重跑本 skill
- 超限 / 規格問題 → 人工決策（規格問題建議 `spex-write-spec`）
