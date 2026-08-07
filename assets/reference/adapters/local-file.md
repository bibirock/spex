# Tracker Adapter — Local File（無 Tracker 模式）

本文件為 Local File adapter，當 ADO MCP 不可用時作為 fallback。
所有 Spex 資料改以 Markdown 檔案寫入本機 `specs/` 目錄，可在無網路環境下完整執行。

**分支前綴：** `LOCAL-`

> 📖 **讀取本文件須遵守 [adapters/README.md `## Skills 引用 Adapter 規範`](./README.md#skills-引用-adapter-規範)**：skill 引用時只讀對應 `TRACKER.*` 章節，禁止整檔載入。

---

## 目錄結構

```
specs/
  <id>/                        ← 以 item ID（slug）命名的目錄
    item.md                    ← readItem 的資料來源
    comments/
      spec.md                  ← [Spex] Spec 完成 的留言（write-spec，可選）
      fixbug.md                ← [Spex] Fixbug 完成 的留言
      plan.md                  ← [Spex] Plan 完成 的留言
      task.md                  ← [Spex] Task 完成 的留言
      implement.md             ← [Spex] Implement 完成 的留言
      verify.md                ← [Spex] Verify 完成 / Verify Fail 的留言（最新一筆）
      pull-request.md          ← [Spex] PullRequest 完成 的留言
      schedule.md              ← [Spex] Schedule 完成 的留言（批次彙總，可選）
    tasks/
      T-001.md                 ← 每個子任務一個檔案
      T-002.md
      ...
    tasks-state.json           ← 子任務狀態與依賴邊追蹤
```

**ID（slug）規則：**

- ADO 為數字 ID（`1234`），目錄即為 `specs/1234/`
- 無 Tracker 時請使用者提供唯一的 slug，例如 `feat-login`、`fix-yaml-export`
- Slug 只使用小寫英數字與連字號，不含空格

---

## `TRACKER.readItem(id)` → Local File 實作

讀取 `specs/<id>/item.md` 的 Front Matter 與內容。

**若檔案不存在：**

```
specs/<id>/item.md 尚未建立。
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

**支援頂層規格建卡。** 建立方式與 `TRACKER.readItem(id)` 的「檔案不存在時自動建立」路徑相同——直接寫入 `specs/<id>/item.md`，Front Matter 對應如下：

| 抽象欄位                 | item.md Front Matter / 章節                                      |
| ------------------------ | ---------------------------------------------------------------- |
| 規格項目型別             | Front Matter `type`                                              |
| `title`                  | Front Matter `title`                                             |
| `description`            | `## 描述` 章節內容                                               |
| `acceptanceCriteria`     | `## 驗收標準` 章節內容                                           |
| 估點（Story Points）     | 無原生欄位——寫入 `## 預估開發點數` 章節純文字，不寫 Front Matter |
| workspace / project 預設 | 不適用（無此概念，slug 即識別碼）                                |

無工作量欄位的原生支援，write-spec Phase 5.5 的估點結果直接以 Markdown 章節保存（見 `spec-template.md` 的「預估開發點數」章節格式），不強行對應到 Front Matter。

---

## `TRACKER.findSpecComment(id, phase)` → Local File 實作

讀取 `specs/<id>/comments/<phase-lower>.md`。

phase 對應檔案名稱：

| phase 參數      | 讀取檔案                                                      |
| --------------- | ------------------------------------------------------------- |
| `"Spec"`        | `comments/spec.md`                                            |
| `"Fixbug"`      | `comments/fixbug.md`                                          |
| `"Plan"`        | `comments/plan.md`                                            |
| `"Task"`        | `comments/task.md`                                            |
| `"Implement"`   | `comments/implement.md`                                       |
| `"Verify"`      | `comments/verify.md`（PASS 與 Fail 共用同檔，檔內即最新一筆） |
| `"PullRequest"` | `comments/pull-request.md`                                    |
| `"Schedule"`    | `comments/schedule.md`                                        |

**若檔案不存在：**

- 回傳 `{ found: false, content: null }`
- Skill 告知使用者：
  ```
  specs/<id>/comments/<phase>.md 不存在，代表 <phase> 階段尚未完成。
  請選擇：
  (a) 我還沒做 <phase> → 我會回 `spex-<phase-lower>`
  (b) <phase> 內容在其他位置 → 請貼上規格摘要
  (c) 直接從 item.md 抽取重建 → 我會列出並請你確認
  ```

**若檔案存在：**

- 回傳 `{ found: true, content: "<檔案完整內容>" }`

---

## `TRACKER.addComment(id, content)` → Local File 實作

將 `content` 寫入對應的 comments 檔案。

**由 skill 傳入的 `content` 第一行必須包含 `## [Spex] <phase> 完成`（Verify 失敗為 `## [Spex] Verify Fail`）**，據此決定寫入目標：

| 留言標題                                                    | 寫入路徑                                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `## [Spex] Spec 完成`                                  | `specs/<id>/comments/spec.md`                         |
| `## [Spex] Fixbug 完成`                                | `specs/<id>/comments/fixbug.md`                       |
| `## [Spex] Plan 完成`                                  | `specs/<id>/comments/plan.md`                         |
| `## [Spex] Task 完成`                                  | `specs/<id>/comments/task.md`                         |
| `## [Spex] Implement 完成`                             | `specs/<id>/comments/implement.md`                    |
| `## [Spex] Verify 完成` / `## [Spex] Verify Fail` | `specs/<id>/comments/verify.md`（覆寫＝保留最新一筆） |
| `## [Spex] PullRequest 完成`                           | `specs/<id>/comments/pull-request.md`                 |
| `## [Spex] Schedule 完成`                              | `specs/<id>/comments/schedule.md`                     |

寫入步驟：

1. 確認 `specs/<id>/comments/` 目錄存在，若不存在則建立
2. 建立或覆寫對應 `.md` 檔案，寫入 `content`

**寫入前確認（所有呼叫此操作的 skill 都必須遵守）：**

```
即將寫入 specs/<id>/comments/<phase>.md，請確認內容無誤後輸入「確認」；
若需調整請說明修改內容，調整後再寫入。
```

收到明確確認（「確認」/「ok」/「yes」）後才執行寫入。

---

## `TRACKER.ensureBranch(params)` → Local File 實作

操作步驟與 ADO adapter 完全相同（純本地 `git` 操作，與 tracker 系統解耦），差別**只在分支前綴**——組分支名用本文件開頭宣告的 `LOCAL-`，不是 ADO 的 `ADO-`。實作細節見 [azure-devops/ado.md](./azure-devops/ado.md#trackerensurebranchparams)。

local-file 模式下若使用者未使用 git 倉庫，回 `{ success: false, reason: "not a git repository" }`，skill 應提示使用者初始化或停止流程。

---

## `TRACKER.createChildTask(params)` → Local File 實作

建立 `specs/<id>/tasks/<taskId>.md`，並更新 `tasks-state.json`。

**步驟一：決定 `childId`**

- 從 `tasks-state.json` 讀取目前最大 task 序號（若不存在則從 1 開始）
- `childId` 格式：`local-task-<n>`（例：`local-task-1`）

**步驟二：建立任務檔案**

```markdown
---
childId: local-task-<n>
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

寫入 `specs/<id>/tasks/<taskId>.md`（`taskId` 取自 `params.title` 中的 `T-XXX`）。

**步驟三：更新 `tasks-state.json`**

```json
{
  "tasks": {
    "T-001": { "childId": "local-task-1", "state": "todo" },
    "T-002": { "childId": "local-task-2", "state": "todo" }
  },
  "dependencies": [
    { "predecessor": "local-task-1", "successor": "local-task-2" }
  ]
}
```

（`dependencies` 由 `TRACKER.linkDependency` 維護，建卡時不需填。）

回傳 `{ success: true, childId: "local-task-<n>" }`。

---

## `TRACKER.updateTaskState(id, state)` → Local File 實作

狀態映射表（**抽象** → **Local File**）：

| 抽象狀態      | local 狀態字串 | task 檔案 Front Matter |
| ------------- | -------------- | ---------------------- |
| `in-progress` | `in_progress`  | `state: in_progress`   |
| `done`        | `done`         | `state: done`          |
| `removed`     | `removed`      | `state: removed`       |

步驟：

1. `id` 為 `local-task-<n>` 形式，由 `tasks-state.json` 查找對應的 taskId（`T-XXX`）
2. 讀取 `specs/<parentId>/tasks/<taskId>.md`，修改 Front Matter 中的 `state`
3. 更新 `tasks-state.json` 中對應 task 的 `state`

---

## `TRACKER.getParentMetadata(id)` → Local File 實作

讀取 `specs/<id>/item.md` 的 Front Matter，取出：

- `assignedTo`
- `iterationPath`

若欄位為 `null`，照實回傳 `null`（skill 使用時可選擇略過）。

---

## `TRACKER.getParentImages(id)` → Local File 實作

Local File 不支援附件，依協定仍實作此操作但**永遠回傳 `[]`**。
spex-task 收到空陣列時略過圖片區段。

---

## `TRACKER.linkDependency(predecessorId, successorId)` → Local File 實作

在 `specs/<parentId>/tasks-state.json` 的 `dependencies` 陣列追加一筆邊：

```json
{ "predecessor": "<predecessorId>", "successor": "<successorId>" }
```

步驟：

1. 讀取 `tasks-state.json`；無 `dependencies` 鍵 → 先補空陣列
2. 兩個 ID 必須存在於 `tasks` 映射中（`childId` 欄位），否則回 `{ success: false, reason: "unknown task id" }`
3. **冪等**：同一筆邊已存在 → 直接回 `{ success: true }`，不重複加
4. 寫回檔案，回 `{ success: true, reason: null }`

此操作不單獨走寫入前確認——由 task Phase 5.5 一次展示全部邊、單次確認後逐邊呼叫。

---

## `TRACKER.getDependencies(parentId)` → Local File 實作

讀取 `specs/<parentId>/tasks-state.json` 與 `tasks/` 下各任務檔組裝回傳：

1. `tasks`：遍歷 `tasks-state.json` 的 `tasks` 映射，每筆取 `childId`、`state`，`title` 自對應 `tasks/<taskId>.md` 的 Front Matter `title`
2. `edges`：把 `dependencies` 陣列逐筆轉成 `{ predecessorId: <predecessor>, successorId: <successor> }`
3. 無 `dependencies` 鍵或為空 → `edges: []`（呼叫端 fallback 到 Task 留言「依賴」欄）

---

## `TRACKER.createPullRequest(params)` → Local File 實作

Local File 模式**無 PR 概念**，依協定仍實作但一律回：

```
{ success: false, pullRequestId: null, url: null, reason: "local-file adapter 不支援 Pull Request" }
```

`spex-pull-request` skill 收到此回應時：告知使用者本模式無法開 PR，改以 `comments/pull-request.md` 留存「PR 內容草稿」（title / description / work items），由使用者自行決定後續（例如改用 ADO adapter 或手動處理）。

---

## `TRACKER.updatePullRequest(params)` → Local File 實作

同 `createPullRequest`：不支援，一律回 `{ success: false, reason: "local-file adapter 不支援 Pull Request" }`。

---

## Local File 特有注意事項

1. **ID（slug）必須唯一** — 若使用者提供的 slug 已存在 `specs/` 下其他目錄，提示使用者確認是否要繼續使用（可能是同一功能繼續作業）。
2. **無網路環境** — Local File Adapter 完全不需要網路。適合離線開發或 ADO 連線不穩的情況。
3. **版本控制** — `specs/` 目錄建議納入 `git` 版本控制，方便團隊分享 Spex 產出。
4. **迭代路徑的替代** — 無 ADO 時 `iterationPath` 無意義，可填入 Sprint 名稱或留空。
