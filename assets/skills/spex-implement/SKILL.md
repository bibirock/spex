---
name: spex-implement
description: 依照 tracker 相關的 task 逐一執行 TDD 實作（Red → Green → Refactor）及 tracker 同步，完成後做父卡全流程驗證並交棒 spex-selfcheck 獨立驗收。本 skill 不開 PR（PR 開立屬 spex-pull-request）。前置：spex-task（Tier 2）或 spex-plan Tier 1 開卡。後續：spex-selfcheck。
---

# Spex: Implement — 實作執行

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 0 / 3.A 讀任務 |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 0 找 Task 留言 |
| [`TRACKER.getDependencies`](../../reference/adapters/README.md#trackergetdependenciesparentid) | Phase 2 讀依賴邊建 DAG |
| [`TRACKER.updateTaskState`](../../reference/adapters/README.md#trackerupdatetaskstateid-state) | Phase 3.G 標記任務狀態 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | F.5 escalation 留言；F.4 Fail 留言；Phase I 完成留言 |

## 規則載入與記憶快取（最先執行）

依 adapters/README.md 的 grep+offset SOP 主動讀取所需章節（章節 grep 不到 → fallback 整檔讀），不依賴編輯器自動載入：

- `.claude/rules/sdd-workflow.md` — 「核心原則」「Branch Naming」「分支生命週期」「Fail 判定」「Definition of Done」「程式碼導航策略」「對抗式詰問」「章戳鏈（蓋章 / 驗章）」章節；批次驅動時另讀「spex-schedule 批次模式互動確認規則」「多 Repo 執行紀律」「ID 事實鐵則」章節
- `.claude/rules/commands.md` — 整檔（驗證指令束唯一來源）
- `.claude/rules/testing.md` — 整檔（測試框架 / E2E 指令 / UI 驗證工具 / artifact 目錄唯一來源）

探索結果寫入 memory（`type: project`，檔名固定 `sdd-rules-cache.md`，同 key 更新不新增）供下次取用；與當前規則檔不符時以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-implement` 的 `active` 教訓，把其「防護」納入本輪實作前注意點；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

資深工程師角色，依任務清單執行 TDD（Red → Green → Refactor），不偷跑、不過度設計。
涉及 UI 流程驗證時，使用 testing 規則指定的 UI 驗證工具（瀏覽器 MCP）直接互動，逐步走流程、確認對真實 UI 有效的 selector，並產出/更新測試檔。

**執行模式：主 agent 依序執行所有任務，不派 subagent**（context 以 Phase 0.5 的 compact 策略管理）。品質審查類代理（G.2.5 code-reviewer、Phase I `/review`）不在此限。

**本 skill 不開 PR**：流程終點是 Phase I 的「Implement 完成」留言，之後交棒 `spex-selfcheck` 獨立驗收；PR 開立只能由 `spex-pull-request` 執行。

## When to Use

- ✅ Tasks 已確認，準備開始編碼
- ✅ selfcheck Verify Fail 後依重做清單修正
- ❌ Tasks 尚未確認 → 用 `spex-task`（Tier 1 由 `spex-plan` 開卡）

## 驗證指令束（後續引用）

下文「驗證指令」皆指 commands 規則的「驗證指令束（SDD 流程引用）」定義的指令序列與執行順序。實際指令字串與並行規則以該規則檔為唯一來源。

---

## Process

### Phase 0: 上下文判斷（最先執行）

| 條件 | 行動 |
|---|---|
| 對話中已含任務清單（T-XXX、AC、TDD 步驟、tracker ID） | 直接進 Phase 1 |
| 對話中無 Task 資訊 | 先自動取 ID：執行 `git branch --show-current`，依 SDD workflow 規則的「Branch Naming」格式解析 tracker item ID（符合自動化流程，不需詢問）；不符才向使用者詢問 ID。取得後 → `TRACKER.readItem(id)` + `TRACKER.findSpecComment(id, "Task")` 依 adapter 協定取出 `### 任務摘要 / TDD 流程 / Escalation 停損點 / 子任務狀態` |
| selfcheck 重做模式（對話含 Verify Fail 重做清單） | 以重做清單為任務範圍，僅修正所列缺失，完成後回 `spex-selfcheck` |

- 若 `findSpecComment` 回傳 `found: false` → 告知使用者先跑 `spex-task`（Tier 2）；Tier 1 則先跑 `spex-plan`（Phase 2.8 會自動開單張 Task 卡）。
- **子卡清單以 `TRACKER.getDependencies(parentId)` 為準**（tracker 事實），`## [Spex] Task 子卡對照` 留言的 `T-XXX → #<childId>` 表為輔助對照；逐一 `TRACKER.readItem(<childId>)` 取得驗收標準與檔案清單。Task 留言本體刻意不含真實子卡 ID（見 `spex-task` Phase 5.6）。

---

### Phase 1: 前置條件確認

**分支驗證（強制最先）：** 執行 `git branch --show-current`，必須符合 SDD workflow 規則的「Branch Naming」定義的命名格式與驗證 regex。不符 → 停止，依 SDD workflow 規則的「分支生命週期」處理。

- ✅ 分支符合命名規則
- ✅ 任務清單存在於對話
- ✅ SDD workflow 規則已載入或可讀

---

### Phase 2: 解析依賴關係

1. **優先**呼叫 `TRACKER.getDependencies(parentId)` 以 tracker 原生依賴連結建 DAG。
2. `edges` 為空 → fallback：以 Task 留言「任務摘要」表的「依賴」欄建邊，並提示可補跑 `spex-task` Phase 5.4 把依賴寫回 tracker。
3. 輸出可執行順序：起點為所有無依賴的任務，之後依拓撲順序排列（同層依 T-XXX 編號遞增、依序執行）。
4. 循環依賴 → 停止，回 `spex-task` 重設計。

---

### 單任務執行流程（A→G）

Phase 3：依 Phase 2 順序，主 agent 逐任務依序執行 A → G。

#### A. 確認任務範圍與卡片狀態

呼叫 `TRACKER.readItem(<childId>)`，依 `state` 行動：

| state | 行動 |
|---|---|
| `todo` / `To Do` | 直接執行 |
| `in_progress` / `In Progress` | 讀檔案評估進度，從未完成處續做 |
| `done` / `removed` | 跳過 |

依賴未完成 → 不可執行此任務。

#### B. TDD — Red

依驗收標準寫失敗測試。建檔後**立即執行**，確認失敗原因符合 AC（非環境/語法錯誤）。

> 必須依照執行的 Task 卡片內規範走完。

顯示 `✓ Red Phase 完成`。

#### C. TDD — Green

寫符合任務測試通過的實作。執行測試確認通過。

顯示 `✓ Green Phase 完成`。

#### D. TDD — Refactor

確保：

- [ ] 無重複邏輯
- [ ] 命名清晰
- [ ] 型別安全（依 SDD workflow 規則的「核心原則 / 型別安全」）
- [ ] 移除「以後可能會用到」的程式碼
- [ ] 不在程式碼寫任何原因描述

執行驗證指令束 → 全綠。

UI / 佈局 / 拖放 / 視覺反饋類任務：

- 「程式化斷言 PASS（單元 / 整合 / E2E spec）」與「視覺對齊 AC」是兩件事，兩者皆成立才可進 G。
- 視覺對齊做法見 testing 規則的「UI Verification」章節（dev server / 瀏覽器 MCP / 截圖比對 AC / console 監聽）。
- 視覺驗證未通過 → 退回 Refactor，不可進 commit。

##### D.1 UI / E2E artifact 清理（commit 前必做）

凡是執行過 UI 驗證工具（瀏覽器 MCP 截圖等）或完整 E2E 指令的任務，**commit 前必須清理**過程中產生的暫存 artifact；Phase I 收尾時再次確認。

**E2E 測試腳本（`.spec.ts` / `.e2e.ts`）屬專案程式碼，必須 commit 進版控**，以便後續相關變動時不用每次重寫。只清理「執行產物」，不刪測試腳本。

artifact 分兩類處理（具體目錄清單見 testing 規則的「E2E artifact 目錄」）：

| 類別 | 處理時機 |
|---|---|
| **立即清理**（D.1 / I） | testing 規則的「E2E artifact 目錄」所列項目，**排除** E2E HTML 報告目錄 → commit 前刪除 |
| **暫留至 PR** | E2E HTML 報告目錄（見 testing 規則的「E2E HTML 報告」）→ 由 `spex-pull-request` 開立 PR 並附上報告連結後刪除 |

執行步驟：

1. `git status --short` 列出全部 untracked / modified 檔案。
2. 依上表分類，逐項以 `rm -f <檔>` / `rm -rf <目錄>` 刪除「立即清理」類 artifact。**保留** E2E HTML 報告目錄（暫留至 PR）。
3. **禁止**使用 `git clean -fdX`、`git clean -fd`、`rm -rf *.png` 等批次指令，避免誤刪使用者既有的設計稿、文件附圖或非本任務的 untracked 檔。
4. 若無法判斷某 untracked 檔是否屬於本次 artifact → 保留，並在回報中明列請使用者確認，不擅自刪除。
5. 清理後再次 `git status --short`，確認 working tree 僅剩本任務應提交的程式碼變動與暫留的 E2E HTML 報告目錄。

清理完成後才能進 G 步驟。視覺驗證、單元測試與 artifact 清理三者皆成立後顯示 `✓ Refactor 完成`，才可進入 commit 流程。

#### F. Escalation 處理

##### F.1 開卡接續（預設）

實作中發現 plan / task 未列的延伸問題時：

1. 暫停當前任務 commit
2. 建立新 tracker 子卡（`TRACKER.createChildTask`），新子卡 `workItemType` **必須與同層既有子卡一致**（spex 流程下通常為 **Task**）
3. 父卡留 escalation 留言（見 F.5）
4. 對新卡跑 A → G 子流程
5. 新卡 commit 後回到原任務，端到端驗證 AC
6. 原任務通過 → commit → 繼續主依賴圖

##### F.2 停損

任一情況觸發 → 立即停止任務鏈並依下表行動，通知使用者：

| 情況 | 行動 |
|---|---|
| 需修 API schema 且影響跨服務契約 | 重跑 `spex-plan` |
| 需切換 Tier 並涉及 server/api 新端點 | 重跑 `spex-plan` |
| 循環依賴或整體架構翻修 | 重跑 `spex-plan` |
| 安全 / 權限核心邏輯需重設計 | 通知使用者 |

##### F.3 其他情境

| 情況 | 處理 |
|---|---|
| 測試連續失敗 2 次 | 呼叫 Github MCP or StackOverflow MCP 尋求協助，勿盲目重試 |
| 查詢結果後仍失敗 2 次 | 停止任務鏈，通知使用者並等待決策 |
| 檔案數超過任務上限 | 拆 helper；無法拆 → 走 F.1 |
| 發現可重構但不在 AC | 不順手改，記為獨立 Tech Debt Story |

##### F.4 E2E 測試失敗流程（含 Fail 判定）

**第一次失敗**

- 檢視錯誤日誌，判斷原因（selector 變動、timing 問題、環境相依）。
- 若為偶發性問題（timing / 非決定性），重試一次。

**第二次失敗**

- 不再試錯；改為外部知識查詢（用當前 agent 實際可用的工具，名稱依環境而定）：
  - **網頁搜尋 / 抓取**工具搜相似 E2E 問題（關鍵字：error msg + testing 規則指定的 E2E 工具名）
  - **GitHub 程式碼 / issue 搜尋**工具在相關套件倉庫找已知 issue 與修法
  - **Stack Overflow / 套件文件**查詢工具比對錯誤模式
- 若有可應用的解決方案 → 套用後重新執行（最多再試 1 次）。

**仍無法修復 → 判定 Fail（不得 skip、不得繞過）**

依 SDD workflow 規則「Fail 判定」：

1. 對父卡寫 Fail 留言（展示後依寫入前確認規則處理）：

```
## [Spex] Verify Fail

> 階段：Implement F.4 | 任務：T-XXX | 日期：<DATE>

### 失敗摘要
<失敗場景、錯誤訊息、重試與外部查詢紀錄、無法修復原因>

### 未過項目
| # | AC / 測試 | 缺失描述 | 證據位置 | 怎樣才算過 |

### 下一步
待人工決策（修正後回 `spex-implement` 續做）
```

2. 任務狀態**保持非 done**（絕不把失敗任務標記完成）
3. **阻斷整鏈**：停止後續任務，不進 Phase I，更不得進 selfcheck / pull-request
4. 通知使用者等待決策
5. **教訓捕捉（Capture / Distill）**：於寫 Fail 留言的同時，依 `.claude/reference/spex/lessons-template.md` 萃取一則教訓到 `.claude/lessons/`（`trigger: implement-f4`，`skills:` 含 `spex-implement`）：首次先 `mkdir -p .claude/lessons/`；grep `INDEX.md` 比對「症狀＋根因」——命中 → `recurrence+1`、更新 `lastSeen`；否則新建 `L-<seq>.md` 並補一列索引。此步不改被測程式碼、不解除阻斷。**Promote（升級提案）不在 implement**——集中由 `spex-selfcheck` 主編排者於 `recurrence ≥ 2` 時提出，implement 只負責捕捉。

> ⛔ 禁止舊行為：「skip 失敗測試、標記待人工接手、繼續流程」——失敗就是 Fail，不存在「測試不過但流程繼續」的路徑。

##### F.5 留言格式

父任務 tracker 留言區須含：觸發條件、根因、處置模式（F.1 / F.2 / F.3 / F.4）、新卡 ID、當前任務狀態、對 plan 的反饋。

#### G. 標記任務完成

**步驟 1**：開始實作 → `TRACKER.updateTaskState(<task-id>, "in-progress")`

**步驟 2**：執行驗證指令束，全綠才繼續。

**步驟 2.5**：品質審查（**僅本任務變動檔案**）：

```bash
git diff --name-only HEAD
```

將清單交給以下 SKILL，禁止掃描整個專案：

- /code-reviewer (官方 Claude Code skill)

確認沒有 Critical Issue 後才能進下一步；有 → 走 F.4 流程。
- **code-reviewer**：使用原生`/code-reviewer` skill，設定嚴格審查標準（Critical / Important / Done Well），**必須**對每個變動檔案執行，且**必須**給出明確評語（不接受 vague comment）。

輸出：

```
🔍 T-00X 品質審查
code-reviewer: Critical / Important / Done Well
```

**Critical Issues → 範疇確認**：

| 判斷 | 行動 |
|---|---|
| ✅ 在 AC 範圍 | 修復 → 重跑步驟 2 |
| ⛔ 超出 AC 範圍 | 不實作，一行記為待辦 Story，繼續提交 |

幻覺指標：「缺少 X 功能」/「應支援 Y」/「用戶無法做 Z」→ 預設判定 Story。

**步驟 3**：**必須**呼叫 `/commit-message` skill 產生訊息，**不可自行手寫**。格式、ID 解析等規則皆由該 skill 定義（見 `commit-message/SKILL.md`）。訊息產生後直接 `git commit`（自動執行，不需使用者確認）。

**步驟 4**：任務全部 AC 達成後 → `TRACKER.updateTaskState(<task-id>, "done")`。

#### H. 進行下一任務

重複 A–G 至所有任務完成。

---

### Phase I: 所有子任務完成後——父卡全流程驗證與閉環（必做）

當所有子任務完成時，針對父卡核心流程補齊測試並做端到端驗證：

1. 以父卡 AC 為基準，整理「主流程 + 關鍵分支 + 失敗情境」撰寫測試案例。
2. 使用 testing 規則指定的 UI 驗證工具走完整流程，校正 selector 與步驟時序。
3. E2E 測試只跑父卡對應的測試檔，確認全綠（0 failed）；失敗 → 走 F.1 開卡接續或 F.4 Fail 判定。
4. 全線 E2E 以 headless 模式跑出 HTML 報告（路徑見 testing 規則「E2E HTML 報告」），整理成 Markdown 表格；報告目錄暫留至 PR 開立。
5. **artifact 清理（強制）**：依 [D.1](#d1-ui--e2e-artifact-清理commit-前必做) 同樣規則再做一次（「立即清理」類刪除、E2E HTML 報告目錄暫留）。`git status --short` 必須只剩程式碼變動與暫留的報告目錄。
6. ✅ **官方 `/review` 通過**：呼叫 Claude Code 官方 `/review` skill 對整個任務鏈累積變動做一次 PR 級審查；Critical Issue 依 G.2.5 的範疇確認分流，全清才進下一步。
6.5. ✅ **對抗式詰問（交棒前硬閘門）**：起草下方留言後，呼叫 `.claude/skills/spex-challenge/SKILL.md`，stage = `implement`、round = 本輪輪次。
   - **圍欄（`challenge-draft`）＝ 下方留言草稿本體逐字**，不含引章宣稱行。
   - 詰問輸入另附：規格、Task 留言、`git diff <targetBranch>...HEAD`、測試檔變更清單、證據包（宣稱數字的來源指令與 `file:line`）。**禁止**餵入實作推理與對話歷史。
   - FAIL → 依修正清單改**程式碼／產出**後重詰（輪次上限見規則檔「詰問輪次上限」行；超限停止升級人工，**不寫完成留言、不交棒 selfcheck**）。
   - 章面缺失 → 重派同輪；**嚴禁自書章面或自算 sha256**。
7. **寫入 Implement 完成留言**（本體逐字＝圍欄內容，末尾追加引章宣稱行；寫入前呼叫 `.claude/skills/spex-stamp/SKILL.md` 驗章，**exit ≠ 0 不得寫入、不得交棒**）：

```
## [Spex] Implement 完成

> 父卡：#<parentId> | 日期：<DATE>

### 子任務
- T-XXX → #<childId>：done

### 驗證
- 驗證指令束全綠 | 父卡 E2E 全流程 0 failed
- E2E 新增測試：<檔名 + case 清單>
- E2E HTML 報告：<連結或本機路徑>（暫留至 PR 開立）

### 下一步
`spex-selfcheck`（獨立驗收）

challenge：PASS（第 <n> 輪｜章 <章號>）
```

---

## Red Flags

- ❌ 呼叫 `TRACKER.createPullRequest`（PR 開立屬 `spex-pull-request`，本 skill 禁止）
- ❌ 跳過 selfcheck 直接開 PR 或宣告交付完成
- ❌ 跳過任務直接實作
- ❌ Green 後沒 Refactor 直接進下一任務
- ❌ 程式碼含 `any` / `console.log` / `debugger`
- ❌ Critical Issue 未做範疇確認就實作
- ❌ F.1 級延伸問題硬走 F.2 停損
- ❌ 開新卡沒在父任務留 escalation 留言
- ❌ 新卡 `workItemType` 與同層既有子卡不一致
- ❌ E2E 失敗到「仍無法修復」卻 skip 測試繼續流程（必須 F.4 Fail 判定停鏈）
- ❌ 失敗任務被標記 done
- ❌ 涉及 UI 流程卻未依 testing 規則的「UI Verification」驗證就進 commit
- ❌ 跳過 Phase I 6.5 詰問直接寫完成留言 / 交棒 selfcheck
- ❌ 自書章面、自算 sha256，或以「修正已納入」自行宣告 PASS（＝偽造）
- ❌ 蓋章後潤飾留言本體（S5 內容綁定必炸）
- ❌ E2E 測試失敗兩次卻未呼叫外部知識查詢就接手或通知使用者
- ❌ commit 訊息卡在確認流程（必須自動執行）
- ❌ 未呼叫 `/commit-message` 而自行手寫 commit 訊息
- ❌ UI Verification / E2E 完成後沒清理「立即清理」類 artifact 就 commit
- ❌ E2E 測試腳本（`.spec.ts` / `.e2e.ts`）被當成 artifact 刪除而未 commit 進版控
- ❌ 用 `git clean -fdX` 或 `rm -rf *.png` 等批次指令清理 artifact（必須逐項刪除）
- ❌ 任務鏈結束沒寫 Implement 完成留言

## Verification

- [ ] 對話中已有完整任務清單
- [ ] Phase 2 已用 `TRACKER.getDependencies` 建 DAG（或標明 fallback 留言「依賴」欄）
- [ ] 所有任務按拓撲順序由主 agent 依序完成
- [ ] 每任務 R / G / R 完整；驗證指令束全綠
- [ ] code-reviewer 已對變動檔案執行；Critical 已範疇確認
- [ ] Escalation 依 F.1 / F.2 / F.3 / F.4 分流並寫入留言
- [ ] F.4 走到「仍無法修復」時已寫 Verify Fail 留言並停鏈（未 skip）
- [ ] 每任務 commit 訊息由 `/commit-message` 自動產生並直接提交
- [ ] UI 任務：① 斷言性測試 PASS ② UI Verification 全綠，兩者皆成立
- [ ] E2E 測試腳本已 commit 進版控；artifact 依 D.1 清理
- [ ] 父卡層級 E2E 全流程 0 failed；官方 `/review` Critical 全清
- [ ] Implement 完成留言已寫入（含 E2E 報告連結）
- [ ] tracker 子任務全數更新為 done / removed

## Next Steps

→ `spex-selfcheck`（獨立驗收）→ PASS 後 `spex-pull-request`（PR 開立）
