# Tracker Adapter — Local File（無 Tracker 模式）

本文件為 Local File adapter，當 ADO MCP 不可用時作為 fallback。
所有 Spex 資料改以 Markdown 檔案寫入本機 `specs/` 目錄，可在無網路環境下完整執行。

**分支前綴：** `LOCAL-`

> 📖 **讀取本文件須遵守 [adapters/README.md `## Skills 引用 Adapter 規範`](./README.md#skills-引用-adapter-規範)**：skill 引用時只讀對應 `TRACKER.*` 章節，禁止整檔載入。

---

## 目錄結構

```
specs/
  20260808/                    ← 日期層＝建卡日（YYYYMMDD）
    feat-login/                ← 任務層＝任務名 slug
      item.md                  ← 卡片本體（readItem / getParentMetadata / 規格建卡）
      spec.md                  ← [Spex] Spec
      fixbug.md                ← [Spex] Fixbug
      plan.md                  ← [Spex] Plan
      task.md                  ← [Spex] Task
      task-children.md         ← [Spex] Task 子卡對照
      implement.md             ← [Spex] Implement
      escalation.md            ← implement F.5 escalation（兜底落點，見 addComment）
      verify.md                ← [Spex] Verify 完成 / Verify Fail（逐輪保留）
      pull-request.md          ← [Spex] PullRequest（本模式存 PR 草稿）
      schedule.md              ← [Spex] Schedule 完成
      schedule-branch.md       ← [Spex] Schedule 批次分支（僅錨點卡有）
      tasks/
        T-001.md               ← 子卡；childId 即 T-001
        T-002.md
      tasks-state.json         ← 子卡狀態 + 依賴邊
      attachments/             ← 選用；getParentImages 的來源
```

階段留言檔**平放在任務資料夾**（無 `comments/` 子層），方便直接瀏覽一張卡的完整歷程。

---

## ID 規則（雙向確定映射）

**ID ＝ `<YYYYMMDD>-<slug>`**，例：`20260808-feat-login`。

| 方向 | 規則 |
| --- | --- |
| ID → 路徑 | 以 `^(\d{8})-(.+)$` 拆解：group 1 為日期層、group 2 為任務層 → `specs/<日期>/<slug>/` |
| 路徑 → ID | 日期層目錄名 + `-` + 任務層目錄名 |

- **不需 glob**：任何操作拿到 ID 都能直接組出路徑再讀檔。
- **唯一性由結構保證**：同名 slug 落在不同日期不會撞名，不必額外靠人工規矩維護唯一性。
- **slug 格式**：小寫英數字與連字號，不含空格與底線；不可以 8 位數字開頭（否則拆解會誤判日期層）。
- ID 一律**由檔案系統回讀**（建立目錄後回讀實際目錄名），不可由模型推算——見 `sdd-workflow.md`「ID 事實鐵則」。

### ⛔ 日期層永不搬移

日期是**建卡日**，資料夾建立後**不隨工作日變動**。同一張卡跨多天推進仍留在原資料夾。

理由：ID 由路徑推導，搬資料夾等於換 ID——已建立的分支名（`feature/LOCAL-<id>-…`）、已寫入的留言引用、commit 訊息內的 ID 會全部失聯。要按「當前工作日」瀏覽請用 `git log` 或編輯器搜尋，不要動目錄。

---

## 留言檔格式（append-only 事件記錄）

**所有階段留言檔一律 append-only，最新在最上**，每筆以機器可讀標記分隔：

```markdown
<!-- spex:entry seq=2 at=2026-08-08T14:30:00+08:00 -->
## [Spex] Verify 完成

> 輪次：第 2 輪 | 判定：PASS | 日期：2026-08-08

<留言本體>

<!-- spex:entry seq=1 at=2026-08-08T11:05:00+08:00 -->
## [Spex] Verify Fail

> 輪次：第 1 輪 | 判定：FAIL | 日期：2026-08-08

<留言本體>
```

- `seq`：該檔內單調遞增，從 1 起算。
- `at`：ISO-8601 帶時區。
- **不覆寫既有 entry**。任何階段都可能重跑（implement 重做後會再寫一次完成留言、selfcheck 逐輪寫 Verify），舊筆一律保留——`spex-schedule` Phase 4.A 對帳要驗留言鏈完整性，教訓閉環的 Capture 也以那些 Fail 為來源。
- **與章戳鏈的關係**：`sdd-workflow.md`「章戳鏈」規定蓋章後不得潤飾留言本體。此格式在結構上保障了這件事——新一輪是**新 entry**，不動舊 entry，章所綁定的內容原文永久保留、隨時可重新計算雜湊比對。

### 讀取 SOP（取最新一筆）

沿用 adapters/README「Agent 讀取 SOP」的 grep+offset 手法，不整檔載入：

```
grep -n '<!-- spex:entry' <檔案>          # 取前兩個行號
Read(<檔案>, offset=<第 1 個行號>, limit=<第 2 個行號 - 第 1 個行號>)
```

只有一筆時省略 `limit` 讀到檔尾。

---

## `TRACKER.readItem(id)` → Local File 實作

依「ID 規則」把 `id` 拆成日期層與任務層，讀取 `specs/<日期>/<slug>/item.md` 的 Front Matter 與內容。

**若檔案不存在：**

```
specs/<日期>/<slug>/item.md 尚未建立。
請提供以下資訊（或貼上現有描述），我將自動建立初始 item.md：

- 標題：
- 類型（Feature / Bug / User Story）：
- 描述：
- 驗收標準：
```

建立格式：

```markdown
---
id: <id>
type: <Feature|Bug|User Story>
title: <標題>
state: in-progress
assignedTo: null
iterationPath: null
---

## 描述

<description>

## 驗收標準

<acceptanceCriteria>

## 重現步驟（Bug 專用）

<reproSteps>
```

建立時的日期層取**當下日期**；`id` 欄位寫入回讀後的實際 `<日期>-<slug>`，不預先推算。

回傳欄位映射：

| 抽象欄位             | item.md 對應                       |
| -------------------- | ---------------------------------- |
| `type`               | Front Matter `type`                |
| `title`              | Front Matter `title`               |
| `description`        | `## 描述` 章節內容                 |
| `state`              | Front Matter `state`               |
| `acceptanceCriteria` | `## 驗收標準` 章節內容             |
| `reproSteps`         | `## 重現步驟（Bug 專用）` 章節內容 |
| `assignedTo`         | Front Matter `assignedTo`          |
| `iterationPath`      | Front Matter `iterationPath`       |

**路線對應（供 skills 做抽象分流）：**

| Local File `type`                        | skills 應採用的路線名稱 |
| ---------------------------------------- | ----------------------- |
| `Feature` / `Requirement` / `User Story` | `需求路線`              |
| `Bug`                                    | `缺陷路線`              |

- skills 應依 `TRACKER.readItem(id).type` 做路線分流，不應在 skill 內寫死 local-file 的欄位結構。
- 若未來 local-file 支援其他 `type`，應先在本 adapter 補上對應路線，再由 skills 沿用抽象名稱。

---

## 規格建卡欄位對照（write-spec 專用）

**支援頂層規格建卡。** 建立方式與 `TRACKER.readItem(id)` 的「檔案不存在時自動建立」路徑相同——建 `specs/<當下日期>/<slug>/` 後寫入 `item.md`，Front Matter 對應如下：

| 抽象欄位                 | item.md Front Matter / 章節                                      |
| ------------------------ | ---------------------------------------------------------------- |
| 規格項目型別             | Front Matter `type`                                              |
| `title`                  | Front Matter `title`                                             |
| `description`            | `## 描述` 章節內容                                               |
| `acceptanceCriteria`     | `## 驗收標準` 章節內容                                           |
| 估點（Story Points）     | 無原生欄位——寫入 `## 預估開發點數` 章節純文字，不寫 Front Matter |
| workspace / project 預設 | 不適用（無此概念，`<日期>-<slug>` 即識別碼）                     |

slug 由使用者提供或自標題產生（小寫英數 + 連字號）；建目錄後**回讀實際目錄名**組出 ID 回傳，不預先推算。

無工作量欄位的原生支援，write-spec Phase 5.5 的估點結果直接以 Markdown 章節保存（見 `spec-template.md` 的「預估開發點數」章節格式），不強行對應到 Front Matter。

---

## `TRACKER.findSpecComment(id, phase)` → Local File 實作

依「ID 規則」定位任務資料夾，讀對應階段檔的**最新一筆 entry**（讀法見「留言檔格式 › 讀取 SOP」）。

phase 對應檔案：

| phase 參數                | 讀取檔案            |
| ------------------------- | ------------------- |
| `"Spec"`                  | `spec.md`           |
| `"Fixbug"`                | `fixbug.md`         |
| `"Plan"`                  | `plan.md`           |
| `"Task"`                  | `task.md`           |
| `"Task 子卡對照"`         | `task-children.md`  |
| `"Implement"`             | `implement.md`      |
| `"Verify"`                | `verify.md`（PASS 與 Fail 同檔逐輪 append，最新一筆即當前判定） |
| `"PullRequest"`           | `pull-request.md`   |
| `"Schedule"`              | `schedule.md`       |
| `"Schedule 批次分支"`     | `schedule-branch.md` |

**若檔案不存在：**

- 回傳 `{ found: false, content: null }`
- Skill 告知使用者：
  ```
  specs/<日期>/<slug>/<phase>.md 不存在，代表 <phase> 階段尚未完成。
  請選擇：
  (a) 我還沒做 <phase> → 我會回 `spex-<phase-lower>`
  (b) <phase> 內容在其他位置 → 請貼上規格摘要
  (c) 直接從 item.md 抽取重建 → 我會列出並請你確認
  ```

**若檔案存在：**

- 回傳 `{ found: true, content: "<最新一筆 entry 的內容，不含 spex:entry 標記行>" }`
- 需要歷史筆數（對帳、輪次追溯）時另讀整檔，但一般階段判定只取最新一筆。

---

## `TRACKER.addComment(id, content)` → Local File 實作

把 `content` 以**新 entry prepend** 到對應階段檔（不覆寫既有內容）。

**由 skill 傳入的 `content` 第一行決定寫入目標。** 比對規則：取第一行、剝除 `[tier-<n>]` 等後綴，再比對下表：

| 留言標題                                          | 寫入檔                |
| ------------------------------------------------- | --------------------- |
| `## [Spex] Spec 完成`                             | `spec.md`             |
| `## [Spex] Fixbug 完成`                           | `fixbug.md`           |
| `## [Spex] Plan 完成`                             | `plan.md`             |
| `## [Spex] Task 完成`                             | `task.md`             |
| `## [Spex] Task 子卡對照`                         | `task-children.md`    |
| `## [Spex] Implement 完成`                        | `implement.md`        |
| `## [Spex] Verify 完成` / `## [Spex] Verify Fail` | `verify.md`           |
| `## [Spex] PullRequest 完成`                      | `pull-request.md`     |
| `## [Spex] Schedule 完成`                         | `schedule.md`         |
| `## [Spex] Schedule 批次分支`                     | `schedule-branch.md`  |
| **上表皆不符**                                    | `escalation.md`（兜底） |

**關於兜底落點**：`spex-implement` F.5 的 escalation 留言沒有固定的 `[Spex]` 標題，其他 skill 未來也可能新增留言型別。這些一律寫進 `escalation.md`（同樣 append-only），**不得靜默丟棄**——寫入後於回報中明列「已落 escalation.md（未匹配既有 phase）」，讓使用者知道有一筆非標準留言，必要時再回本 adapter 補對照。

寫入步驟：

1. 依「ID 規則」定位任務資料夾；不存在 → 回 `{ success: false, reason: "item not found" }`（不自動建卡）
2. 目標檔不存在 → 以 `seq=1` 建檔；存在 → 以 `grep -m1 -oE 'seq=[0-9]+'` 取當前最大 `seq`，新 entry 用 `seq+1`
3. 在**檔首** prepend：`<!-- spex:entry seq=<n> at=<ISO8601> -->`＋空行＋`content`＋空行，原有內容接在後面

**寫入前確認（所有呼叫此操作的 skill 都必須遵守）：**

```
即將寫入 specs/<日期>/<slug>/<phase>.md（新增第 <n> 筆，不覆寫既有紀錄），
請確認內容無誤後輸入「確認」；若需調整請說明修改內容，調整後再寫入。
```

收到明確確認（「確認」/「ok」/「yes」）後才執行寫入。

---

## `TRACKER.ensureBranch(params)` → Local File 實作

操作步驟與 ADO adapter 完全相同（純本地 `git` 操作，與 tracker 系統解耦），差別**只在分支前綴**——組分支名用本文件開頭宣告的 `LOCAL-`，不是 ADO 的 `ADO-`。實作細節見 [azure-devops/ado.md](./azure-devops/ado.md#trackerensurebranchparams)。

分支名形如 `feature/LOCAL-20260808-feat-login-add-oauth`。ID 含日期使分支名較長，屬預期；仍符合 `sdd-workflow.md`「Branch Naming」的 `<type>/<PREFIX>-<id>-<kebab-summary>` 格式。

local-file 模式下若使用者未使用 git 倉庫，回 `{ success: false, reason: "not a git repository" }`，skill 應提示使用者初始化或停止流程。

---

## `TRACKER.createChildTask(params)` → Local File 實作

建立 `specs/<日期>/<slug>/tasks/<childId>.md`，並更新 `tasks-state.json`。

**步驟一：決定 `childId`（回讀，不推算）**

- 列出 `tasks/` 現有檔名，取 `T-(\d+)` 的最大序號 +1（目錄不存在 → 從 1 起算）
- 格式 `T-<3 位數>`（`T-001`、`T-002`…）
- **`childId` 就是這個值**，不另設第二組 ID

**步驟二：建立任務檔案**

```markdown
---
childId: T-<n>
parentId: <params.parentId>
title: <params.title>
assignedTo: <params.assignedTo>
iterationPath: <params.iterationPath>
state: todo
---

## 任務描述

<params.description>

## 驗收標準

<params.acceptanceCriteria>
```

> ⚠️ **附件路徑改寫**：`params.description` 若含 `getParentImages` 回傳的 `<img src="attachments/…">` 片段，寫入前必須把 `attachments/` 改為 `../attachments/`——子卡檔位於 `tasks/` 下一層，不改路徑必斷連結。

**步驟三：更新 `tasks-state.json`**

```json
{
  "tasks": {
    "T-001": { "state": "todo" },
    "T-002": { "state": "todo" }
  },
  "dependencies": [
    { "predecessor": "T-001", "successor": "T-002" }
  ]
}
```

（`dependencies` 由 `TRACKER.linkDependency` 維護，建卡時不需填。）

回傳 `{ success: true, childId: "T-<n>" }`。

---

## `TRACKER.updateTaskState(id, state)` → Local File 實作

狀態映射表（**抽象** → **Local File**）：

| 抽象狀態      | local 狀態字串 | task 檔案 Front Matter |
| ------------- | -------------- | ---------------------- |
| `in-progress` | `in_progress`  | `state: in_progress`   |
| `done`        | `done`         | `state: done`          |
| `removed`     | `removed`      | `state: removed`       |

步驟：

1. `id` 為 `T-<n>` 形式（無需查映射表——childId 即檔名主體）
2. 讀取 `specs/<日期>/<slug>/tasks/<id>.md`，修改 Front Matter 的 `state`
3. 更新 `tasks-state.json` 中 `tasks.<id>.state`

兩處必須同時更新；只改一處會讓 `getDependencies` 與子卡檔說法不一致。

---

## `TRACKER.getParentMetadata(id)` → Local File 實作

讀取 `specs/<日期>/<slug>/item.md` 的 Front Matter，取出：

- `assignedTo`
- `iterationPath`

若欄位為 `null`，照實回傳 `null`（skill 使用時可選擇略過）。

---

## `TRACKER.getParentImages(id)` → Local File 實作

掃描 `specs/<日期>/<slug>/attachments/`，每個圖片檔（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.svg`）回傳一筆：

```
{
  alt:  "<檔名去副檔名>",
  html: "<img src=\"attachments/<檔名>\" alt=\"<alt>\">"
}
```

- `html` 的路徑**相對於任務資料夾**（`item.md` 所在層）。
- ⚠️ **呼叫端改寫責任**：把片段寫進 `tasks/T-XXX.md` 時必須改為 `../attachments/`（見 `createChildTask` 步驟二）。寫進任務資料夾同層的檔案則原樣可用。
- `attachments/` 不存在或無圖片 → 回傳 `[]`，`spex-task` 收到空陣列時略過圖片區段。

---

## `TRACKER.linkDependency(predecessorId, successorId)` → Local File 實作

在 `specs/<日期>/<slug>/tasks-state.json` 的 `dependencies` 陣列追加一筆邊：

```json
{ "predecessor": "<predecessorId>", "successor": "<successorId>" }
```

步驟：

1. 讀取 `tasks-state.json`；無 `dependencies` 鍵 → 先補空陣列
2. 兩個 ID 必須存在於 `tasks` 映射（即 `T-XXX` 鍵），否則回 `{ success: false, reason: "unknown task id" }`
3. **冪等**：同一筆邊已存在 → 直接回 `{ success: true }`，不重複加
4. 寫回檔案，回 `{ success: true, reason: null }`

此操作不單獨走寫入前確認——由 task Phase 5.4 一次展示全部邊、單次確認後逐邊呼叫。

---

## `TRACKER.getDependencies(parentId)` → Local File 實作

讀取 `specs/<日期>/<slug>/tasks-state.json` 與 `tasks/` 下各任務檔組裝回傳：

1. `tasks`：遍歷 `tasks-state.json` 的 `tasks` 映射，鍵即 `childId`，取其 `state`；`title` 自對應 `tasks/<childId>.md` 的 Front Matter `title`
2. `edges`：把 `dependencies` 陣列逐筆轉成 `{ predecessorId: <predecessor>, successorId: <successor> }`
3. 無 `dependencies` 鍵或為空 → `edges: []`（呼叫端 fallback 到 Task 留言「依賴」欄）

---

## `TRACKER.createPullRequest(params)` → Local File 實作

Local File 模式**無 PR 概念**，依協定仍實作但一律回：

```
{ success: false, pullRequestId: null, url: null, reason: "local-file adapter 不支援 Pull Request" }
```

`spex-pull-request` skill 收到此回應時：告知使用者本模式無法開 PR，改以 `pull-request.md` 留存「PR 內容草稿」（title / description / work items），由使用者自行決定後續（例如改用 ADO adapter 或手動處理）。

---

## `TRACKER.updatePullRequest(params)` → Local File 實作

同 `createPullRequest`：不支援，一律回 `{ success: false, reason: "local-file adapter 不支援 Pull Request" }`。

---

## Local File 特有注意事項

1. **日期層永不搬移** — 見上方「ID 規則」。搬資料夾等於換 ID，會讓分支名、留言引用、commit 內的 ID 全部失聯。
2. **留言 append-only，不覆寫** — 任何階段都可能重跑；舊筆是對帳（`spex-schedule` Phase 4.A 留言鏈完整性）與教訓 Capture 的來源，也是章戳內容綁定得以重驗的前提。
3. **未匹配的留言落 `escalation.md`，不得靜默丟棄** — 並於回報中明列，讓使用者有機會回本 adapter 補對照。
4. **slug 不可以 8 位數字開頭** — 會讓 `^(\d{8})-(.+)$` 誤判日期層。
5. **無網路環境** — Local File Adapter 完全不需要網路。適合離線開發或 ADO 連線不穩的情況。
6. **版本控制** — `specs/` 目錄建議納入 `git` 版本控制，方便團隊分享 Spex 產出。
7. **迭代路徑的替代** — 無 ADO 時 `iterationPath` 無意義，可填入 Sprint 名稱或留空。
