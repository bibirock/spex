---
name: spex-schedule
description: 批次排程執行器。指定多個卡片編號（或 tracker 查詢、specs/ 目錄等任務來源），自動執行時從 base 分支切出單一共用分支 `chore/schedule-<YYYYMMDD-HHmm>`（時間戳到分，同日可多批；續行依 tracker 留言記錄的分支沿用），整批所有卡片都在此分支上依序套用 SDD workflow（plan → task → implement → selfcheck），批次結束對帳通過後呼叫 spex-pull-request 開「一個」涵蓋全批的 PR 給使用者確認；每輪迭代重新從 tracker 盤點全部卡片狀態，以終態唯一性與結束前對帳保證不遺漏任何過程及任務；起跑序固定先以 /plan 唯讀盤點＋確認＋授權，核准後由執行驅動三選一推進（小批次手動即可；大批次或要無人值守跑到完用 /goal；卡片常等外部事件用 /loop），支援中斷續行與失敗隔離。前置：各卡片規格已寫入 description。後續：人類 reviewer。
---

# Spex: Schedule — 多卡片批次排程

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | 每輪盤點各卡狀態與標題 |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | 每輪推導各卡當前階段（留言鏈）；續行時讀回批次分支留言 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 2.5 寫入批次分支留言（續行唯一依據）；Phase 5 可選彙總留言 |
| [`TRACKER.getDependencies`](../../reference/adapters/README.md#trackergetdependenciesparentid) | 對帳時檢查卡內子任務終態 |

## 規則載入與記憶快取

啟動時依 adapters/README.md 的 grep+offset SOP 主動讀取（章節 grep 不到 → fallback 整檔讀）：

- `.claude/rules/sdd-workflow.md` — 「Branch Naming」「Branch Policy」「分支生命週期」「PR 開立控管」「Fail 判定」章節

各卡片內的階段執行由被呼叫的 skill 自行載入其規則，本 skill 不重複。探索結果寫入 memory（`type: project`）；不符時以規則檔為準並更新。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-schedule` 的 `active` 教訓，把其「防護」納入本批編排注意點；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

批次排程者（level-triggered reconciler）。**唯一職責：把一批卡片逐一、依序推過 SDD 實作流程，並保證批次結束時每張卡都處於唯一終態、沒有任何卡片或階段被遺漏，最後合併為一個 PR 交人類確認。** 不自帶任何階段邏輯——逐卡依當前階段呼叫既有 skill（plan / task / implement / selfcheck）。

四條設計鐵則（依工程慣例）：

1. **每輪重新盤點，tracker 是唯一事實來源**：每次迭代開頭重新從 tracker 讀回全部卡片的留言鏈推導階段，不信任上一輪的記憶或本機快取（外部變更、人工介入都會在下一輪被自動修正）。看板表只是顯示用途，不是狀態權威。
2. **終態唯一性**：每張卡最終必須是 `done`（**最新 Verify 留言為 PASS**——批次模式下卡片實作的終態是 selfcheck PASS，PR 留到批次結束統一開）或 `blocked`（人工佇列，附原因）兩者之一；批次不允許在留有第三態的情況下宣告完成。
3. **依序、不平行**：一次只推進一張卡；卡片之間完全依序（精度優先）。
4. **單一共用分支、批次結束一個 PR**：批次啟動時從 base 切出 `chore/schedule-<YYYYMMDD-HHmm>`（見 SDD workflow 規則「Branch Naming › 排程批次共用分支」），整批所有卡片都在此分支上實作、**不逐卡建分支、卡片間不切回 base**；對帳通過後**呼叫** `spex-pull-request`（批次最終模式）開**一個**涵蓋全批的 PR。schedule **自身禁止**呼叫 `TRACKER.createPullRequest`（唯一入口仍在 pull-request skill）。

## When to Use

- ✅ 有多張卡片要連續走 SDD 流程（sprint backlog、一批需求）
- ✅ 一段範圍要整批跑（MVP tag、sprint、WIQL 查詢）→ plan 階段凍結成 ID 清單
- ✅ 中斷後重啟批次（自動跳過已完成卡片續行）
- ✅ 單張卡但想無人值守跑完整鏈（批次 = 1，搭配 /goal）
- ❌ 單張卡且在場逐階段操作 → 直接 `spex-plan` 起跑各 skill

**典型呼叫**：`/spex-schedule 幫我執行 1001 1002 1003 … 等卡片（或範圍如 MVP tag）使用 plan 來規劃` → 得到計畫＋一條可貼上的 /goal 指令（見 Phase 2）→ 送出 /goal 無人值守跑完並開批次 PR。

---

## Process

> **起跑序（規範）：`/plan`（必經）→ 執行驅動（手動 / `/goal` / `/loop` 三選一）**。批次一律先在 **plan 模式**完成「盤點 + 分類確認 + 批次授權」（唯讀，不動 code / 分支 / tracker），經使用者核准計畫（ExitPlanMode）後，進入執行階段把整批推到全終態並開批次 PR。**小批次核准後手動跑即可、不需要 goal；大批次或要無人值守跑到完才用 /goal**（見下方「驅動模式」）。依 SDD workflow 規則「spex-schedule 批次模式互動確認規則 › 起跑序」。
>
> | 階段 | 模式 | 涵蓋 Phase | 性質 |
> |---|---|---|---|
> | **A. 計畫** | `/plan`（唯讀） | Phase 0 任務來源（範圍凍結）→ Phase 1 盤點看板（**對話內呈現**，不落檔）→ Phase 2 分類確認＋收集批次授權＋**交付可貼上的 /goal 指令** | 不建分支、不寫 tracker、不改 code |
> | **B. 執行** | 手動 / `/goal` / `/loop`（三選一） | Phase 2.5 建共用分支（分支名寫入 tracker 留言）→ Phase 3 逐卡推進 → Phase 4 對帳 + 批次 PR → Phase 5 彙報 | 首個 mutation 是 Phase 2.5 建分支 |
>
> **第一個寫入動作（建分支 / 寫檔 / 動 tracker）一律在離開 plan 模式之後**；plan 模式只讀不寫。下方 Phase 0–2 屬計畫階段、Phase 2.5 起屬執行階段。

### Phase 0: 任務來源收集

接受以下任一來源，統一轉成**卡片 ID 清單**（保持輸入順序）：

| 來源 | 做法 |
|---|---|
| **ID 清單**（主要） | 使用者直接給多個卡片編號（例：`1001 1002 1003`） |
| **tracker 查詢 / 範圍**（如 MVP tag） | ADO：依 adapter 擴充操作 `ADO.queryWorkItems` 取清單（無查詢工具時請使用者自行查好貼上 ID）；查詢條件由使用者提供（sprint / 標籤 / WIQL） |
| **local-file** | 掃描 `specs/` 目錄下的 item 目錄名作為 ID 清單 |

清單去重；空清單 → 停止。

> **範圍凍結**：來源是查詢 / 範圍（MVP tag 等）→ 在 plan 階段**解析成具體 ID 清單並凍結**，後續 /goal 以這份凍結清單為準、**不**每輪重跑查詢（避免範圍中途漂移）。要納入新卡 → 重跑一次 /plan 產生新計畫。

### Phase 1: 盤點（每輪從 tracker 重新盤點，對話內呈現看板）

列出清單中每張卡的標題、當前階段、下一步行動（見下表）與終態（done / blocked / 進行中）：
用以讓執行中斷的任務可以回溯進度，並在對帳時保證沒有遺漏任何卡片或階段。

- **唯一持久化在 tracker**：進度由 tracker 留言鏈每輪重新推導，**不落任何本機檔案**；計畫與執行兩階段皆只於**對話內**以看板形式呈現。
- **壓縮 / 換手 / 斷線後**：下一輪重新從 tracker 盤點即自動還原進度，不依賴本機狀態（後續者只憑 tracker 即可接手）。

對清單中**每張卡**重新推導當前階段（level-triggered，不沿用上一輪結果）：

1. `TRACKER.readItem(id)` → 標題、state、description 是否含規格
2. 依留言鏈推導階段（`findSpecComment` 由後往前查，找到即停）：

| 最新存在的留言 | 當前階段 → 下一步 |
|---|---|
| `Verify 完成`（PASS） | **done（卡片終態）**：實作完成，PR 留到批次結束統一開（見 Phase 4） |
| `Verify Fail`（輪次 < 3） | 重做 → `spex-implement`（依重做清單）→ `spex-selfcheck` |
| `Verify Fail`（輪次 ≥ 3） | **blocked（終態）**：selfcheck 超限待人工 |
| `Implement 完成` | 待驗收 → `spex-selfcheck` |
| `Task 完成`（子任務未全 done） | 任務鏈 → `spex-implement`（其 Phase 2 建 DAG 依序執行、Phase 3.A 自動從未完成處續做） |
| `Plan 完成`（Tier 2、無 Task） | 拆任務 → `spex-task` |
| 無 Plan 留言 | 分類起點 → `spex-plan` |
| description 無規格 | **blocked（終態）**：規格缺失，留言建議 `spex-write-spec` |

3. 卡片間依賴（可選）：盤點時若發現清單內卡片之間有原生 Predecessor/Successor 連結 → 拓撲排序覆寫輸入順序；無連結 → 維持輸入順序。
4. 輸出排程看板（**首輪全量；後續輪次用增量看板**——只列「狀態有變化的卡」+ 一行進度計數，未變化卡省略，控 token），於對話內呈現：

```
📋 排程看板 — <來源描述> | 共用分支 chore/schedule-<YYYYMMDD-HHmm> | 第 <k> 輪
| # | 卡片 | 標題 | 當前階段 | 下一步 | 終態 |
|---|---|---|---|---|---|
| 1 | #1001 | <標題> | Verify 完成（PASS） | — | ✅ done |
| 2 | #1002 | <標題> | Implement 完成 | selfcheck | 進行中 |
| 3 | #1003 | <標題> | 無 Plan 留言 | plan | 待處理 |

進度：done <X> / blocked <Y> / 未達終態 <Z>（總數 <N>）｜全部 done 後 → Phase 4 對帳 → 開一個批次 PR
```
- 排程執行中 skill 確認點的統一行為依 SDD workflow 規則執行
- 續行（非首輪 / 中斷重啟）且排程範圍未變 → 不重複確認，直接 Phase 3；新增卡片 → 對新增部分重新確認

### Phase 2: 計畫核准與 /goal 交付（計畫階段結尾，唯讀）

> plan 模式的交付物——產出計畫供使用者核准，並回給一條**可直接貼上執行的 /goal 指令**。仍唯讀，不動 code / 分支 / tracker。典型觸發：使用者以「`/spex-schedule 幫我執行 <卡片清單 / 範圍> 使用 plan 來規劃`」呼叫。

1. **凍結範圍**：依 Phase 0「範圍凍結」把查詢 / 範圍解析成具體 ID 清單並凍結進計畫。
2. **分類預判**：對未起跑卡片（無 Plan 留言）概述預期路線 / Tier（細節由各卡 plan skill 於執行階段定）；降 Tier / 降規模屬不可自決，於計畫標記待人工。
3. **批次授權收集**（可選但建議）：詢問是否給「**授權本批次全自動開立 PR**」——給了 → /goal 連 Phase 4.B 批次 PR 一起自動開；不給 → /goal 跑到 Phase 4.B 暫停等確認。
4. **ExitPlanMode 計畫交付**，內容含：
   - 排程看板（Phase 1）＋凍結 ID 清單（共 `<N>` 張）
   - 將建立的共用分支名（執行階段 Phase 2.5 才實際建）
   - 批次授權狀態（已授權 / 待 Phase 4.B 確認）
   - **執行方式建議**（依批次大小，見「驅動模式」）：
     - **小批次**（估計一個 context 跑得完）→ 核准計畫後**直接執行即可**（手動驅動），毋須 /goal。
     - **大批次 / 要無人值守跑到完** → 附上**可直接貼上的 /goal 指令**（`<N>` = 凍結清單卡片數）：

```
/goal 用 spex-schedule 推進卡片 #<id1> #<id2> …（凍結清單）到全部達終態且批次 PR 已開立（排程看板 done + blocked = 總數、Phase 4.A 對帳通過、Phase 4.B 批次 PR 完成）or stop after <2×N> turns
```

使用者核准計畫後進入執行階段（Phase 2.5 起）：手動則於 session 內依序跑完；/goal 則每 turn 重新呼叫本 skill 做一個增量步驟（level-triggered 盤點 → 推進 → 看板），由獨立 fast model 驗證達成條件後自動停。

### Phase 2.5: 共用分支建立（執行階段首步，離開 /plan 後）

> 這是執行階段（Stage B）的**第一個 mutation**——必須在 plan 模式核准、進入 /goal（或手動 / /loop）之後才執行；plan 階段不得建分支。每批次只在首輪建立 / 沿用一次。

依 SDD workflow 規則「Branch Naming › 排程批次共用分支」與「分支生命週期 › 排程批次例外」：

1. `git status --short` **必須乾淨**——不乾淨 → 停止請使用者處理，不可硬切。
2. **判斷續行還是全新批次**（先從 tracker 讀「批次分支留言」）：以 `TRACKER.findSpecComment(<錨點卡>, "Schedule 批次分支")` 查批次分支留言（錨點卡 = 凍結清單**首卡**；首卡讀不到 → fallback 依序掃清單其餘卡片）。
   - 讀到留言記錄的共用分支、且該分支存在（`git rev-parse --verify <分支>`）、且批次尚未全部終態 → **續行**：`git checkout <留言記錄的分支>`（**不**另開、**不**用今天日期重推名稱）。
   - 留言讀不到（且各卡皆無批次分支留言）→ **全新批次**：取當前時間到「分」產生 `chore/schedule-<YYYYMMDD-HHmm>`（例：`chore/schedule-20260613-1430`；同一天可多批，時間戳保證不撞名），從 base（dev / develop / development，依「Branch Policy」）切出：`git checkout -b chore/schedule-<YYYYMMDD-HHmm> <base>`。
3. **全新批次切出後**，以 `TRACKER.addComment(<錨點卡>, ...)` 在錨點卡寫一則 `## [Spex] Schedule 批次分支` 留言，記錄**共用分支名 + base + 批次時間戳**——**這是日後續行 / redrive 沿用分支的唯一依據**（存於 tracker，後續者只憑 tracker 即可找回分支，**不可**用日期反推）。整批後續所有卡片都在此分支上實作，**不逐卡建分支、卡片間不切回 base**。
   - 跨機接手提醒：留言讓「分支名」跨機可讀；同事要在另一台機器實際取得 code，仍需共用分支已 push 到 remote（沿用既有 PR 階段 push 行為）。

> 已在正確共用分支上（續行）→ 直接進 Phase 3 逐卡推進，不重複建立。

### Phase 3: 逐卡依序推進

依看板順序取**第一張未達終態的卡**，推進直到該卡「達終態」或「完成一個階段檢查點」：

1. **分支前置**：`git status --short` 必須乾淨（殘留變更 → 停止請使用者處理）；確認當前在共用分支 `chore/schedule-<YYYYMMDD-HHmm>`（Phase 2.5 建立）。批次模式下**不逐卡建分支**——呼叫各 skill 時把卡片 ID 連同「批次模式、共用分支」脈絡一併傳入；plan Phase 2.6 的 `ensureBranch` 偵測已在共用分支 → no-op（見 plan）。
2. 依 Phase 1 推導的「下一步」呼叫對應 skill（一次一個，依序；**不含 pull-request**——PR 留到 Phase 4 批次統一開）：
   - 批次模式下各 skill 的疑點問答若**無人可答**（無人值守）→ 不腦補、不暫停等待：把該卡標 `blocked`（原因：疑點待澄清，疑點清單寫入該卡留言）→ 繼續下一卡
   - selfcheck 的 Fail → implement 重做迴圈在卡內自動進行（上限依 selfcheck 規則）
   - selfcheck 取得 PASS → 該卡即達 `done`（卡片終態），**不**呼叫 pull-request
3. **卡片達終態後**（始終留在共用分支，**不切回 base**）：
   - `done`：working tree 確認乾淨（commit 已落在共用分支）→ 取下一張未達終態的卡
   - `blocked`：記錄原因與斷點 → 取下一卡
4. **斷路器**：**連續 2 張卡 blocked** → 視為系統性故障（環境、權限、規則檔問題），中止整批並彙報，不再消耗後續卡片
5. 卡片完成是天然的 context 檢查點：批次狀態全在 tracker（各卡留言鏈 + 錨點卡的批次分支留言），**不另寫本機檔案**；壓縮後由下一輪重新盤點 tracker 自動還原。需壓縮時可直接 `/compact`（沿用 implement Phase 0.5 條件式策略，壓縮非強制，且不需先寫檔——進度持久化已由 tracker 承擔）

### Phase 4: 對帳 + 批次 PR（宣告完成前必做）；壓縮後第一步重新 Phase 1 盤點 tracker

#### 4.A 對帳（reconciliation）

全部卡片看板顯示終態後，**逐卡重新查 tracker** 做完整性對帳：

1. **終態唯一性**：每卡 = done 或 blocked，無第三態；`盤點總數 = done + blocked` 不符 → 找出漏卡降回「未達終態」重新進 Phase 3（redrive 只補漏，不動 done）
2. **留言鏈完整性**（不得遺漏任何過程）：每張 done 卡依其 Tier 路徑檢查留言鏈完整——Tier 1：`Task [tier-1] + Implement + Verify PASS`；Tier 2：`Plan + Task + Implement + Verify PASS`（批次模式下 `PullRequest` 留言在 4.B 開批次 PR 後才寫，不在此檢查）；缺任一 → 該卡降回對應階段重新推進
2.5. **章戳完整性**：每張 done 卡跑 `.claude/skills/spex-stamp/SKILL.md` 對事件流稽核（Task／Implement 的 challenge 章與 Verify 留言的 `驗收章`）。**exit ≠ 0 → 該卡降回對應階段重新推進**（不得因「留言看起來完整」放行）；無事件流的環境於彙報中標注「本環境無章可驗」，不得宣稱通過
3. **子任務終態**：每張 done 卡 `getDependencies` 確認子任務全為 done / removed
4. 對帳全過才可進 4.B

#### 4.B 批次 PR（對帳通過後，唯一一次）

> 至少一張卡為 done 時才開 PR；全部 blocked → 跳過 4.B，直接 Phase 5 彙報人工佇列。

依 SDD workflow 規則「PR 開立控管 › 唯一入口」，schedule **不**自行呼叫 `TRACKER.createPullRequest`，而是**呼叫** `spex-pull-request`（批次最終模式），傳入：

- `mode: batch-final`、共用分支 `chore/schedule-<YYYYMMDD-HHmm>`、base 分支
- 全部 done 卡片的 work item ID 清單（含各自子任務 ID）
- 批次預授權原文＋時間戳（若 Phase 2 收集到「授權本批次全自動開立 PR」）；未預授權 → pull-request 走互動確認，展示 PR 內容等使用者「確認」

pull-request 對共用分支 → base 開**一個** PR、逐卡寫稽核留言（`## [Spex] PullRequest 完成`，引用同一 PR URL 與授權記錄）。PR 成功後該批 done 卡片的留言鏈才補齊 `PullRequest`。

### Phase 5: 批次結果彙報

```
## 排程批次結果 — <來源描述>

> 總數 <N> | done <X> | blocked <Y> | 共用分支 chore/schedule-<YYYYMMDD-HHmm> | 日期：<DATE>

### 批次 PR
- PR: <url>（涵蓋 done 卡片：#<id...>）| 開立模式：互動確認 / 批次預授權
- 全部 blocked → 「未開 PR（無 done 卡片）」

### 完成清單
| 卡片 | Verify 輪次 |

### 人工佇列（blocked）
| 卡片 | 原因 | 斷點 | 建議動作 |

### 對帳
- 終態唯一性：通過（N = X + Y）
- 留言鏈完整性：通過 / <缺漏修補紀錄>
```

對話輸出；使用者指定彙總卡片時，經寫入前確認後以 `TRACKER.addComment` 留存（標題 `## [Spex] Schedule 完成`）。blocked 清單即下次重跑的輸入（redrive）；redrive 沿用同名共用分支。

---

## 驅動模式（循環檢查）

**起跑序固定：先 `/plan` 後執行驅動。** plan 階段（唯讀）完成 Phase 0–2 盤點與授權、核准計畫；核准後 ExitPlanMode 進入執行階段，由下列三種驅動之一推進（本 skill 每次呼叫都是冪等增量步驟：盤點 → 推進 → 看板）：

| 階段 | 模式 | 用法 | 適用 |
|---|---|---|---|
| **計畫（必經）** | **/plan** | 唯讀跑 Phase 0–2：收集任務來源、盤點看板（對話呈現）、分類確認、收集批次授權（含「**授權本批次全自動開立 PR**」）；ExitPlanMode 呈現計畫等核准 | 一律先做；不動 code / 分支 / tracker |
| 執行（三選一） | **手動** | 核准後直接呼叫本 skill，於同一 turn 內依序推進，直到全部終態或使用者中斷 | **小批次**（估計一個 context 跑得完）、在場監督；plan 核准後直接跑即可，**不需要 goal** |
| 執行（三選一） | **/goal** | 核准後設定：`/goal 排程清單全部卡片達終態且批次 PR 已開立（排程看板 done + blocked = 總數、對帳通過、Phase 4.B 完成）or stop after <2×N> turns` | **大批次 / 長任務 / 要無人值守跑到完**：跨 context 壓縮存活（每輪重新盤點 tracker）、由獨立 fast model 驗證收斂、有 turn 上限 |
| 執行（三選一） | **/loop** | 核准後 `/loop <interval> /spex-schedule <ids>` 定時輪詢推進 | 卡片常在等外部事件（CI、review 回覆）時，按時間間隔回來檢查 |

**怎麼選**：plan 是**必經前置**；執行驅動三選一。**小批次 → 手動就夠**（plan 的 checklist 在 session 內跑完，毋須 goal）；**大批次或要無人值守保證跑到全終態 → /goal**（要的是跨壓縮存活 + 收斂驗證 + turn 上限，這是 session 內 checklist 給不了的）；卡片常等外部 → /loop。

注意：

- 起跑序不可省略 plan 階段：未經 /plan 盤點與授權，不得直接進執行驅動。
- 手動 / /goal / /loop 是**並列的三種執行驅動**，不是漸進關係；goal 並非必選，只在「一個 context 裝不下整批」或「要無人值守跑到完」時才需要。
- /goal 與 /loop 不可同時啟用（互相覆蓋）。
- 批次 PR 自動開立需在 plan 階段取得「授權本批次全自動開立 PR」；未取得 → 執行會推進到 **Phase 4.B 批次 PR** 暫停等使用者確認（這是設計行為，不是卡死——逐卡實作可全自動跑完，最後一個 PR 留給使用者把關）。
- goal 條件务必含上限子句（`or stop after N turns`），避免無法收斂時空轉。

---

## 教訓捕捉（human-feedback）

互動確認點（Phase 2 分類 / 授權、Phase 4.B PR 確認、Phase 5 彙總）若**使用者糾正了本 skill 的提案**（駁回分類、改正編排決策、指出做錯方向），於記錄該回合的同時，依 `.claude/reference/spex/lessons-template.md` 捕捉一則教訓到 `.claude/lessons/`（`trigger: human-feedback`，`skills:` 含 `spex-schedule`，必要時加被糾正階段所屬 skill）：首次先 `mkdir -p .claude/lessons/`；grep `INDEX.md` 比對「症狀＋根因」——命中 → `recurrence+1`、更新 `lastSeen`；否則新建並補索引。純粹「確認 / ok」非糾正，不捕捉。

---

## Red Flags

- ❌ 信任上一輪快取的卡片狀態而不重新盤點（必須 level-triggered）
- ❌ 批次結束時留有「未達終態」卡片卻宣告完成（違反終態唯一性）
- ❌ 跳過 Phase 4 對帳、或對帳發現缺漏卻不 redrive
- ❌ 平行處理多張卡（必須依序）
- ❌ 無人值守下對疑點自行腦補作答（應標 blocked 留言疑點）
- ❌ 批次啟動時 working tree 不乾淨就切共用分支
- ❌ 逐卡建分支、或卡片間切回 base（批次模式一律留在共用分支）
- ❌ 連續 blocked 仍繼續消耗整批（斷路器失效）
- ❌ 本 skill 直接執行任何階段邏輯或呼叫 `TRACKER.createPullRequest`（PR 唯一入口在 pull-request；批次 PR 由本 skill **呼叫** pull-request 開立）
- ❌ 逐卡開 PR（批次模式只在 Phase 4.B 開一個 PR）
- ❌ 把排程確認當成 PR 預授權（兩者是獨立授權；PR 預授權必須含明確語句）
- ❌ 跳過 /plan 計畫階段直接進執行驅動（起跑序違規）
- ❌ 在 plan 模式內建分支 / 寫檔 / 動 tracker（plan 階段只讀不寫）
- ❌ 把批次進度或共用分支名寫進本機檔案——唯一持久化在 tracker，後續者只憑 tracker 接手

## Verification

- [ ] 起跑序：已先以 /plan 完成 Phase 0–2 盤點＋確認＋授權並核准，再進執行驅動
- [ ] 任務來源已轉成去重的 ID 清單；順序（輸入順序或拓撲）已確定
- [ ] 每輪迭代開頭重新盤點全部卡片（非快取）
- [ ] Phase 2 首輪確認完成；批次預授權（若有）已記錄原文＋時間戳
- [ ] 逐卡依序推進；全程留在共用分支、未逐卡建分支、未切回 base
- [ ] blocked 卡片皆附原因與斷點；斷路器規則已生效
- [ ] Phase 4.A 對帳通過（終態唯一性＋留言鏈完整性＋子任務終態）
- [ ] Phase 4.B 已呼叫 pull-request 開一個批次 PR（或全 blocked 時略過並註明）
- [ ] 批次結果彙報已輸出（含批次 PR、人工佇列與成本紀錄）

## Next Steps

- 批次 PR 已開 → 人工 reviewer 審查單一 PR（涵蓋全批 done 卡片）
- 有 blocked → 處理人工佇列後重跑本 skill（redrive 只補 blocked，不動 done；沿用同名共用分支）
- 無人值守需求 → 依「驅動模式」表選 /goal 或 /loop
