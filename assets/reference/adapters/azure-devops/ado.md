# Tracker Adapter — Azure DevOps（ADO）

本文件為 ADO adapter，定義所有 `TRACKER.*` 抽象操作對應的 Azure DevOps MCP 具體呼叫。

**前置條件：** ADO MCP 工具可用（`mcp__azure-devops__*`），且 `AZURE_DEVOPS_PAT` 已設定。

**分支前綴：** `ADO-`

> 📖 **讀取本文件須遵守 [adapters/README.md `## Skills 引用 Adapter 規範`](../README.md#skills-引用-adapter-規範)**：skill 引用時只讀對應 `TRACKER.*` 章節，禁止整檔載入。

---

## 實作對應總覽

| 操作                        | 類別 | 對應工具                                                                      | 備註                                                    |
| --------------------------- | ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `TRACKER.readItem`          | 必填 | `mcp__azure-devops__get_work_item`                                            |                                                         |
| `TRACKER.findSpecComment`   | 必填 | `mcp__azure-devops__get_work_item`（讀 `System.History`）                     |                                                         |
| `TRACKER.addComment`        | 必填 | `mcp__azure-devops__update_work_item`（`additionalFields["System.History"]`） | adapter 內把 skill 傳入的 Markdown 轉 HTML              |
| `TRACKER.ensureBranch`      | 必填 | 本地 `git` 指令（不打 ADO MCP）                                               |                                                         |
| `TRACKER.createChildTask`   | 必填 | `mcp__azure-devops__create_work_item`（workItemType: `Task`）                 |                                                         |
| `TRACKER.updateTaskState`   | 必填 | `mcp__azure-devops__update_work_item`（`state` 欄位）                         |                                                         |
| `TRACKER.getParentMetadata` | 必填 | `mcp__azure-devops__get_work_item`                                            |                                                         |
| `TRACKER.getParentImages`   | 必填 | 從 `System.Description` HTML 萃取 `<img>`                                     | 無圖時回 `[]`                                           |
| `TRACKER.linkDependency`    | 必填 | `mcp__azure-devops__manage_work_item_link`（無此工具時 REST fallback）        | linkType：`System.LinkTypes.Dependency-Forward/Reverse` |
| `TRACKER.getDependencies`   | 必填 | `mcp__azure-devops__get_work_item`（`expand: "relations"`）                   | 子卡走 `Hierarchy-Forward`、依賴走 `Dependency-*`       |
| `TRACKER.createPullRequest` | 必填 | `mcp__azure-devops__list_pull_requests` + `create_pull_request`               | **僅 pull-request skill 可呼叫**（Verify／章戳 Gate 的統一收口）；autoComplete 一律禁用（PR 合併控管） |
| `TRACKER.updatePullRequest` | 必填 | `mcp__azure-devops__update_pull_request`                                      |                                                         |
| `ADO.readAttachment`        | 擴充 | curl + PAT（從 `~/.claude.json` 讀）                                          | 用於讀 description 內嵌圖片                             |
| `ADO.queryWorkItems`        | 擴充 | MCP 查詢類工具（先核對工具清單；無 → 請使用者貼 ID 清單）                     | 用於 schedule 的 tracker 查詢來源                       |

---

## 欄位格式約束

| 欄位                                                                         | 格式                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| Work Item `description`                                                      | **HTML**                                               |
| Work Item `acceptanceCriteria`（`Microsoft.VSTS.Common.AcceptanceCriteria`） | **HTML**                                               |
| Work Item 留言（`System.History`，寫入透過 `additionalFields`）              | **HTML**（adapter 內把 skill 傳入的 Markdown 轉 HTML） |
| PR `title`                                                                   | **Plain text**                                         |
| PR `description`                                                             | **Markdown**                                           |
| 工作項目狀態轉移關鍵字（`Resolves #ID` 等）                                  | 寫於 PR `description` 本文，非 commit message          |

---

## 路線對應

| ADO `System.WorkItemType`                | skills 應採用的路線名稱 |
| ---------------------------------------- | ----------------------- |
| `Feature` / `Requirement` / `User Story` | `需求路線`              |
| `Bug`                                    | `缺陷路線`              |

- skills 應依 `TRACKER.readItem(id).type` 做路線分流，不應在 skill 內寫死 ADO 欄位名稱
- 若未來 ADO 新增其他 Work Item Type，先在本 adapter 補上路線映射，再由 skills 沿用抽象名稱

---

## 規格建卡欄位對照（write-spec 專用）

**支援頂層規格建卡。** `spex-write-spec` Phase 6 代為建卡時，需求路線的規格卡一律建為 **`Product Backlog Item`**（PBI），**不要**用 `User Story`（若貴組織的 ADO process 採 Scrum 模板，工作項目型別即為 PBI；若採其他 process 模板，請對照調整此欄位值）。description 寫入 `System.Description`、AC 寫入 `Microsoft.VSTS.Common.AcceptanceCriteria`（皆 HTML）。注意 ADO 無法以 API 變更既有卡的類型——建錯類型只能刪卡 / UI 改型重建，故建立前先確認類型。

**點數自動帶入（強制）**：`create_work_item` 時把 write-spec Phase 5.5 的精確估點寫入 `additionalFields["Microsoft.VSTS.Scheduling.Effort"]`（純數字，如 `5`）——這是 Scrum PBI 的原生點數欄，ADO velocity 圖表讀它。父 Epic 帶 rollup 總點、各子 Story 帶各自精確估點。⚠️ **`Effort` 在卡片進入 `Done` 後唯讀**（實測 `update_work_item` 回 `TF401320 Rule Error for field Effort ... ReadOnly`），事後無法用 API 補填（closed 卡須先 reopen 才能改），故**務必於建卡當下帶入**，不可留到之後。

**欄位對照表：**

| 抽象欄位             | ADO 欄位                                                       | 格式                    |
| -------------------- | -------------------------------------------------------------- | ----------------------- |
| 規格項目型別         | `workItemType: "Product Backlog Item"`                         | 固定值，非 `User Story` |
| `iterationPath`      | `iterationPath`（範例：`MyProject\\Sprint-24`，請替換為貴組織實際的 iteration 路徑）    | Plain                   |
| `description`        | `description`（落地為 `System.Description`）                   | HTML                    |
| `acceptanceCriteria` | `additionalFields["Microsoft.VSTS.Common.AcceptanceCriteria"]` | HTML                    |
| 估點                 | `additionalFields["Microsoft.VSTS.Scheduling.Effort"]`         | 數字，`Done` 後唯讀     |

**範例呼叫：**

```
mcp__azure-devops__create_work_item({
  workItemType: "Product Backlog Item",
  title: <標題>,
  iterationPath: "MyProject\\Sprint-24",
  description: <System.Description HTML>,
  additionalFields: {
    "Microsoft.VSTS.Common.AcceptanceCriteria": <AC HTML>,
    "Microsoft.VSTS.Scheduling.Effort": <write-spec Phase 5.5 點數，如 5>
  }
})
```

---

## `TRACKER.readItem(id)`

呼叫：

```
mcp__azure-devops__get_work_item({ workItemId: <id> })
```

**欄位映射：**

| 抽象欄位             | ADO 系統欄位                                |
| -------------------- | ------------------------------------------- |
| `type`               | `System.WorkItemType`                       |
| `title`              | `System.Title`                              |
| `description`        | `System.Description`                        |
| `state`              | `System.State`                              |
| `acceptanceCriteria` | `Microsoft.VSTS.Common.AcceptanceCriteria`  |
| `reproSteps`         | `Microsoft.VSTS.TCM.ReproSteps`（Bug 專用） |
| `assignedTo`         | `System.AssignedTo`                         |
| `iterationPath`      | `System.IterationPath`                      |

**Bug 額外欄位**（`System.WorkItemType === "Bug"` 時加讀）：

- `Microsoft.VSTS.TCM.SystemInfo`
- `Microsoft.VSTS.Common.Severity`

**讀取失敗處理：** MCP 連線失敗或回傳 null → 告知使用者，請其手動貼上 Work Item 內容，**不可跳過**。

---

## `TRACKER.findSpecComment(id, phase)`

呼叫：

```
mcp__azure-devops__get_work_item({ workItemId: <id>, expand: "all" })
```

從回傳的 `System.History` 欄位搜尋符合以下格式的留言：

```
## [Spex] <phase> 完成
```

`Verify` 階段另接受 `## [Spex] Verify Fail`（搜尋 `Verify` 時比對前綴 `## [Spex] Verify`）。
多筆符合時取**最新一筆**（`System.History` 由新到舊排列，取第一個匹配項）。

**找不到 → 回傳 `{ found: false, content: null }`**，skill 應告知使用者並提供三選項：

```
(a) 我還沒做 <phase> → 我會回 `spex-<phase>`
(b) <phase> 內容在 description 或其他位置 → 請貼上規格摘要
(c) 我想直接從 Work Item description 重建 → 我會抽取並請你確認
```

---

## `TRACKER.addComment(id, content)`

協定上 `content` 為 Markdown，adapter 內部轉成 HTML 後寫入 `System.History`。

呼叫：

```
mcp__azure-devops__update_work_item({
  workItemId: <id>,
  additionalFields: {
    "System.History": "<HTML 轉換後內容>"
  }
})
```

**Markdown → HTML 轉換要點：**

- 標題 `## X` → `<h2>X</h2>`
- 清單 `- X` → `<ul><li>X</li>...</ul>`
- 表格 → `<table>...`
- 連結 / 粗體 / 行內程式碼 → 對應 HTML 標籤
- 程式碼區塊 → `<pre><code>...</code></pre>`
- 換行 → `<br>` 或包進 `<p>`

> **寫入前確認規則**：呼叫前必須展示完整留言內容（Markdown 原文即可，使用者不需看到轉換後 HTML）：
>
> ```
> 即將寫入 ADO 留言區，請確認內容無誤後輸入「確認」；
> 若需調整請說明修改內容，調整後再寫入。
> ```
>
> 收到「確認」/「ok」/「yes」後才執行 MCP 呼叫。

---

## `TRACKER.ensureBranch(params)`

純本地 `git` 操作，不呼叫 ADO MCP（ADO `mcp__azure-devops__create_branch` 是建遠端分支，與本協定要的「本地 checkout」語義不同）。

### 步驟一：解析 baseBranch

未指定 `params.baseBranch` 時：

```bash
for candidate in dev develop development; do
  if git show-ref --verify --quiet "refs/heads/${candidate}"; then
    BASE="${candidate}"
    break
  fi
done
```

全部找不到 → 回 `{ success: false, reason: "no default base branch found (dev / develop / development)" }`。

### 步驟二：組分支名

```
<params.type>/ADO-<params.id>-<params.summary>
```

### 步驟三：依狀態執行

```bash
CURRENT=$(git branch --show-current)
TARGET="<組好的分支名>"

if [ "$CURRENT" = "$TARGET" ]; then
  # 已在目標分支
  echo "{ success: true, created: false }"
elif git show-ref --verify --quiet "refs/heads/${TARGET}"; then
  git checkout "$TARGET"          # 已存在但未 checkout
else
  git checkout "$BASE"            # 切到 base
  git pull --ff-only origin "$BASE" 2>/dev/null || true
  git checkout -b "$TARGET"       # 從 base 開新分支
fi
```

### 步驟四：回傳

```
{
  success: <bool>,
  branchName: "<TARGET>",
  baseBranch: "<BASE>",
  created: <true 表示新建 / false 表示已存在>,
  reason: <失敗時 git stderr，否則 null>
}
```

### 注意事項

- **不 push 遠端**：分支首次 push 由 spex-pull-request 的前置檢查處理（本批次流程另有指示時依指示）
- **不 force**：禁 `git checkout -B`、禁 `git reset --hard`
- dirty tree 導致 `git checkout` 失敗 → 直接回 `success: false, reason: <stderr>`，由 skill 提示使用者
- 整個流程不需要 ADO PAT，連線中斷也不影響

---

## `TRACKER.createChildTask(params)`

**步驟一：取得父 Work Item 繼承欄位（若尚未取得）**

```
mcp__azure-devops__get_work_item({ workItemId: params.parentId })
```

取出 `System.AssignedTo` → `params.assignedTo`、`System.IterationPath` → `params.iterationPath`。

**步驟二：建立子任務**

```
mcp__azure-devops__create_work_item({
  workItemType: "Task",
  title: params.title,
  parentId: params.parentId,
  assignedTo: params.assignedTo,
  iterationPath: params.iterationPath,
  description: params.description,
  additionalFields: {
    "Microsoft.VSTS.Common.AcceptanceCriteria": params.acceptanceCriteria
  }
})
```

**欄位格式要求：**

- `title` — 格式：`[T-XXX] <任務名稱>`
- `description` — **HTML**，包含任務描述、相依任務、檔案清單、TDD R/G/R 完整流程
- `additionalFields["Microsoft.VSTS.Common.AcceptanceCriteria"]` — **HTML**，包含驗收標準清單、驗證指令

**回傳 `childId`：** 從 MCP 回傳的 Work Item 物件中取出 `id` 欄位。

> **寫入前確認規則**：同 `addComment`。

---

## `TRACKER.updateTaskState(id, state)`

| 抽象狀態      | ADO 狀態字串  |
| ------------- | ------------- |
| `in-progress` | `In Progress` |
| `done`        | `Done`        |
| `removed`     | `Removed`     |

呼叫：

```
mcp__azure-devops__update_work_item({
  workItemId: <id>,
  state: "<ADO 狀態字串>"
})
```

> ⚠️ 此處參數名是 `workItemId`，與其他工具的 `id` 不同。

---

## `TRACKER.getParentMetadata(id)`

呼叫：

```
mcp__azure-devops__get_work_item({ workItemId: <id> })
```

從回傳物件取出 `System.AssignedTo` → `assignedTo`、`System.IterationPath` → `iterationPath`。

---

## `TRACKER.getParentImages(id)`

從 `TRACKER.readItem(id)` 已取得的 `System.Description` HTML 中，萃取所有 `<img>` 標籤。

**回傳格式：**

```json
[
  {
    "alt": "<原始 alt 文字或 URL-decoded 檔名>",
    "html": "<img src=\"<完整 ADO 附件 URL>\" alt=\"<alt>\">"
  }
]
```

**ADO 附件 URL 特性：**

- 格式：`https://dev.azure.com/<org>/<project-uuid>/_apis/wit/attachments/<UUID>?fileName=<encoded-filename>`
- 在**同一 ADO 組織內**，附件 URL 可跨 WI 直接引用，**無需重新上傳**
- spex-task 嵌入子任務時，直接使用回傳的 `html` 即可渲染

**嵌入至子任務 description 的包裝格式：**

```html
<h3>參考圖片（來自父任務 #<parentId>）</h3>
<p><回傳的 html 欄位></p>
```

description 無 `<img>` → 回傳 `[]`，spex-task 略過圖片區段。

> 若需實際讀取圖片內容（多模態識讀），用擴充操作 `ADO.readAttachment`。

---

## `TRACKER.linkDependency(predecessorId, successorId)`

在 ADO 以原生 **Predecessor / Successor** work item link 建立依賴：後繼任務（successor）掛 `System.LinkTypes.Dependency-Reverse` 指向前置任務（等價於前置任務掛 `System.LinkTypes.Dependency-Forward` 指向後繼）。

### 步驟一：核對工具可用性（強制）

呼叫前先確認當前 session 的 MCP 工具清單是否包含 `mcp__azure-devops__manage_work_item_link`；**沒有此工具 → 直接走步驟三的 REST fallback**，不可嘗試以其他工具參數包裝。

### 步驟二：MCP 主案

```
mcp__azure-devops__manage_work_item_link({
  sourceWorkItemId: <successorId>,
  targetWorkItemId: <predecessorId>,
  operation: "add",
  relationType: "System.LinkTypes.Dependency-Reverse"
})
```

### 步驟三：REST fallback（無 MCP link 工具時）

沿用 `ADO.readAttachment` 的 PAT 取得方式，以 JSON Patch 在 successor 上新增 relation：

```bash
curl -s -X PATCH \
  -u ":${ADO_PAT}" \
  -H "Content-Type: application/json-patch+json" \
  "https://dev.azure.com/<org>/<project>/_apis/wit/workitems/<successorId>?api-version=7.1" \
  -d '[{
    "op": "add",
    "path": "/relations/-",
    "value": {
      "rel": "System.LinkTypes.Dependency-Reverse",
      "url": "https://dev.azure.com/<org>/_apis/wit/workItems/<predecessorId>"
    }
  }]'
```

### 注意事項

- **冪等**：重複加同一連結 ADO 會回錯誤（relation already exists）→ 視為成功（`success: true`），不報錯
- 兩個 ID 須在同一 ADO 組織內；跨組織不可連結
- 此操作不單獨走寫入前確認——由 task Phase 5.5 一次展示全部邊、單次確認後逐邊呼叫

---

## `TRACKER.getDependencies(parentId)`

### 步驟一：取得子任務清單

```
mcp__azure-devops__get_work_item({ workItemId: <parentId>, expand: "relations" })
```

從 `relations` 過濾 `rel === "System.LinkTypes.Hierarchy-Forward"`，自 `url` 尾段取出各子任務 ID。

### 步驟二：逐子任務讀依賴邊與狀態

對每個子任務：

```
mcp__azure-devops__get_work_item({ workItemId: <childId>, expand: "relations" })
```

- `System.Title` → `title`、`System.State` → `state`
- `relations` 中 `rel === "System.LinkTypes.Dependency-Reverse"` → 該連結指向的 ID 為 predecessor，組 edge `{ predecessorId: <指向ID>, successorId: <childId> }`
- `Dependency-Forward` 與 `Dependency-Reverse` 互為鏡像，**只取 `Dependency-Reverse` 組 edges** 避免重複

### 回傳

```
{
  tasks: [{ childId, title, state }],
  edges: [{ predecessorId, successorId }]
}
```

- 子任務無任何 Dependency 連結 → `edges: []`（呼叫端 fallback 到 Task 留言「依賴」欄）
- 注意 API rate limit（約每 5 分鐘 200 請求）：子任務多時逐卡讀取即可，不需並發

---

## `TRACKER.createPullRequest(params)`

> **使用時機**：**僅 `spex-pull-request` skill** — 所有子任務完成、`spex-selfcheck` 最新 Verify 留言為 PASS、章戳 Gate 通過後呼叫（依「PR 開立控管」展示內容留痕即可，不需人為確認）。其他 skill 一律不得呼叫本操作。

### 步驟一：前置檢查

確認分支已 push 到 origin（若否，由 skill 端先 `git push -u origin <sourceBranch>`，**禁止 force push**）。

檢查是否已有同來源/目標的 active PR：

```
mcp__azure-devops__list_pull_requests({
  repositoryId: <repo>,
  status: "active",
  sourceRefName: "refs/heads/<sourceBranch>",
  targetRefName: "refs/heads/<targetBranch>"
})
```

已存在 → 改走 `TRACKER.updatePullRequest`。

### 步驟二：建立 PR

```
mcp__azure-devops__create_pull_request({
  repositoryId: <repo>,
  sourceRefName: "refs/heads/<sourceBranch>",
  targetRefName: "refs/heads/<targetBranch>",
  title: params.title,
  description: params.description,
  isDraft: params.draft ?? false,
  workItemRefs: params.workItemIds,
  reviewers: params.reviewers ?? []
})
```

**欄位格式要求（對齊 Azure DevOps best practice）：**

| 欄位           | 規範                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `title`        | 現在式、具體；格式 `<type>(<scope>): <description> #<parentId>`；不加 `WIP` / `DO NOT MERGE`（改用 `isDraft`）、不加 `[tier-N]`          |
| `description`  | **Markdown** 格式（與 work item description 的 HTML 不同），含「概述 / 主要變動 / 測試 / 手動驗收 / 風險 / 關聯 / 工作項目狀態轉移」段落 |
| `workItemRefs` | 父卡與所有子卡 ID 一併連結，PR 完成時可一次推進狀態                                                                                      |
| `isDraft`      | reviewer 尚未到位時為 `true`（驗證未綠不允許開 PR——由 selfcheck Verify PASS 把關，不以 draft 代替）                                      |

**狀態轉移關鍵字（必須寫在 `description` 本文中，不是 commit message）：**

| 關鍵字           | 行為                                          |
| ---------------- | --------------------------------------------- |
| `Resolves #<ID>` | 合併時轉 `Resolved`                           |
| `Fixes #<ID>`    | 合併時轉至 WIT workflow 對應的 Completed 狀態 |
| `Closes #<ID>`   | 合併時轉 `Closed`                             |
| `Review #<ID>`   | 合併時轉 `Review`                             |

> 若 WIT 已在 `Resolved` 或 `Completed` 類別、或 workflow rule 阻擋（如必填欄位未填），ADO **不會**強制轉移；pull-request skill 應在閉環留言中提醒使用者。

### 步驟三：autoComplete 一律禁用

依 SDD workflow 規則「**PR 合併控管**」，`autoComplete` **一律為 `false`**——它是**預約自動合併**，等同繞過「合併只由人類執行」這條規則。

- 收到 `params.autoComplete === true` → 視為違規：**不呼叫** MCP，停止並告知使用者本流程禁用 auto-complete
- 合併與完成一律由人類 reviewer 於 ADO UI 操作
- 不嘗試以 `additionalProperties` 包裝 `autoCompleteSetBy`，避免靜默失敗

### 步驟四：回傳

從 MCP 回傳取出：

- `pullRequestId`
- `url` 或組裝 `https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<pullRequestId>`

> **寫入前確認規則**：呼叫前必須展示完整 title / description / 連結 work item / reviewers，等使用者「確認」後才執行。

---

## `TRACKER.updatePullRequest(params)`

更新既有 PR 的 title / description / draft / status / reviewers / work item 連結 / tags。

**核心欄位更新：**

```
mcp__azure-devops__update_pull_request({
  repositoryId: <repo>,
  pullRequestId: params.pullRequestId,
  title: params.title,
  description: params.description,
  isDraft: params.draft,
  status: params.status   // "active" / "abandoned"（"completed" = 合併，禁止傳入）
})
```

> ⚠️ **`status: "completed"` 就是合併**。依 SDD workflow 規則「PR 合併控管」，任何 skill 都不得傳入；
> Claude Code 環境由 `spex-merge-guard.sh`（PreToolUse，exit 2）在參數層硬擋——同一個工具改 title / description
> 完全放行，只有帶 `status: completed` 或 autoComplete 家族時才擋。合併一律由人類於 ADO UI 操作。

**Reviewers**（用 add / remove，無裸 `reviewers` 欄位）：

```
mcp__azure-devops__update_pull_request({
  repositoryId: <repo>,
  pullRequestId: params.pullRequestId,
  addReviewers: ["<email-or-id>"],
  removeReviewers: ["<email-or-id>"]
})
```

**Work item 連結：**

```
mcp__azure-devops__update_pull_request({
  repositoryId: <repo>,
  pullRequestId: params.pullRequestId,
  addWorkItemIds: [<id>],
  removeWorkItemIds: [<id>]
})
```

**Tags：** `addTags` / `removeTags`。

> **寫入前確認規則**：同 `addComment`。

---

## PR 描述範本（Markdown，供 spex-pull-request 直接套用）

```markdown
## 概述

<1–2 句，對應父卡 #<parentId> 的核心 AC>

## 主要變動

- <檔案/模組層級的關鍵變動 1>
- <檔案/模組層級的關鍵變動 2>

## 測試

- [x] 單元測試：<新增/更新測試檔範圍>
- [x] 覆蓋率：變動檔逐檔 ≥ 90%（diff-cov）＋ 全域閘門通過
- [x] 父卡 E2E 全流程：<主流程 + 分支 + 失敗情境>（工具依 testing 規則）
- [x] 驗證指令束全綠（指令依 commands 規則）
- [x] 獨立驗收（selfcheck）：Verify PASS，AC 對照表如下

## 驗收對照（selfcheck traceability）

| AC     | 驗證方式        | 證據                 | verdict |
| ------ | --------------- | -------------------- | ------- |
| <AC-1> | <測試名 / 指令> | <檔案:行 / 輸出摘要> | PASS    |

## 手動驗收

1. <步驟 1>
2. <步驟 2>
3. AC 觀察點：<父卡 AC>

## 風險 / 注意事項

- <相容性 / 效能 / Migration / 環境變數；無則填「無」>

## 關聯

- 父任務：#<parentId>
- 子任務：#<childIds...>
- 相關 escalation：#<escalationIds>（若有）

## 工作項目狀態轉移

Resolves #<parentId>
```

> 參考：[Microsoft Learn — Improve pull request descriptions with templates](https://learn.microsoft.com/en-us/azure/devops/repos/git/pull-request-templates?view=azure-devops)、[Automate work item completion with pull requests](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/auto-complete-work-items-pull-requests?view=azure-devops)
>
> 若 repo 已存在 `.azuredevops/pull_request_template.md`，ADO 會自動帶入；spex 流程應**沿用既有模板的標題結構**，避免覆蓋組織級慣例。

---

## 擴充操作

### `ADO.queryWorkItems(criteria)`

> 用於 `spex-schedule` Phase 0 的「tracker 查詢」任務來源：把 sprint / 標籤 / WIQL 條件轉成卡片 ID 清單。

**步驟一：核對工具可用性（強制）**——確認當前 session 的 MCP 工具清單是否含查詢類工具（如 `mcp__azure-devops__search_work_items` 或 WIQL 查詢工具，依實際工具名為準）。

**步驟二：執行查詢**——依工具 schema 帶入條件（iterationPath / tags / WIQL），自結果萃取 work item ID 清單回傳。

**Fallback**：無查詢工具 → 不嘗試以其他工具拼湊；請使用者自行於 ADO 查好並貼上 ID 清單。

注意：查詢結果可能含非開發類 item（如 Epic），schedule 端以 `TRACKER.readItem` 的路線對應過濾。

### `ADO.readAttachment(attachmentUrl)`

> 用於讀取 Work Item `description` 或 `AcceptanceCriteria` HTML 中內嵌的圖片附件。

> **啟用 Docker 沙盒執行模型時**：沙盒內通常無 PAT、防火牆也不開放 `dev.azure.com`，無法在沙盒內直接執行本節的手動 curl 步驟；需改由 Host 端先行下載圖片後以 bind mount 提供給沙盒內執行者用 `Read` 讀取本地檔案。以下手動步驟適用於一般互動式場景（如 write-spec 直接於 Host 端檢視卡片圖片）。

#### 步驟一：從描述 HTML 萃取原始檔名與 API URL

```bash
python3 -c "
import re, urllib.parse

description = '''<貼入 System.Description 原始 HTML>'''

pattern = r'(https://dev\.azure\.com/[^\"]+/_apis/wit/attachments/[a-f0-9-]{36})\?fileName=([^\"&\s]+)'
for url, encoded_name in re.findall(pattern, description):
    filename = urllib.parse.unquote(encoded_name)
    print(f'{filename}\t{url}')
"
```

輸出格式：`<原始檔名>\t<API base URL>`

#### 步驟二：取得 PAT（不顯示原始值）

PAT 存於 Claude Code 全域設定 `~/.claude.json` 的 `projects.<absolute-project-path>.mcpServers.azure-devops.env.AZURE_DEVOPS_PAT`：

```bash
ADO_PAT=$(python3 -c "
import json, os
from pathlib import Path
with open(Path.home() / '.claude.json') as f:
    d = json.load(f)
print(d['projects'][os.getcwd()]['mcpServers']['azure-devops']['env']['AZURE_DEVOPS_PAT'], end='')
")
```

> 若該專案沒有 project-scoped MCP 設定，請改用 `AZURE_DEVOPS_PAT` 環境變數。

#### 步驟三：以原始檔名下載至 `spex-temp/`

**暫存圖片必須使用原始檔名**，讓 Claude 讀圖時能從檔名理解語意。

```bash
FILENAME="登入頁面配色.png"
ATTACH_URL="https://dev.azure.com/<org>/<project-uuid>/_apis/wit/attachments/<UUID>"

# scratch 區用時才建立（spex 不會預先建好這個資料夾）
mkdir -p spex-temp

curl -s -o "spex-temp/${FILENAME}" \
  -u ":${ADO_PAT}" \
  "${ATTACH_URL}?api-version=7.1"

file "spex-temp/${FILENAME}"
```

#### 步驟四：以 Read 工具讀取（多模態）

```
Read("spex-temp/登入頁面配色.png")
```

#### 步驟五：清理暫存（讀取完畢後立即執行）

讀完即刪，**連同 `spex-temp/` 資料夾一起移除**：

```bash
rm -rf spex-temp/
```

#### 批次下載（Work Item 含多張圖時推薦）

```bash
python3 << 'PYEOF'
import re, urllib.parse, subprocess, json, os
from pathlib import Path

DESCRIPTION = """<貼入 System.Description HTML>"""

with open(Path.home() / '.claude.json') as f:
    pat = json.load(f)['projects'][os.getcwd()]['mcpServers']['azure-devops']['env']['AZURE_DEVOPS_PAT']

pattern = r'(https://dev\.azure\.com/[^"]+/_apis/wit/attachments/[a-f0-9-]{36})\?fileName=([^"&\s]+)'
attachments = [
    (urllib.parse.unquote(name), f"{url}?api-version=7.1")
    for url, name in re.findall(pattern, DESCRIPTION)
]

os.makedirs('spex-temp', exist_ok=True)
for filename, api_url in attachments:
    result = subprocess.run(
        ['curl', '-s', '-o', f'spex-temp/{filename}', '-u', f':{pat}', api_url],
        capture_output=True
    )
    print(f"[{'OK' if result.returncode == 0 else 'FAIL'}] {filename}")
PYEOF
```

完整說明見 [./ado-attachment-images.md](./ado-attachment-images.md)。

#### 注意事項

- **原始檔名**：以原始檔名儲存是強制規則，UUID 作為檔名會失去語意
- `spex-temp/` 為 on-demand scratch：用時才 `mkdir`、讀完 `rm -rf` 連資料夾移除；已加入 `.gitignore`
- 含空格的檔名在 bash 中需加引號：`"spex-temp/${FILENAME}"`
- 若 `~/.claude.json` 該 project 沒 azure-devops MCP 設定，改走 `AZURE_DEVOPS_PAT` 環境變數

---

## PAT 政策

違反任一條視為 Critical Security Issue，PR 立即拒絕。

- 🔒 `AZURE_DEVOPS_PAT` 只能從環境變數讀取，絕對不可寫入任何檔案
- 🔒 本地開發：設定於 `~/.zshrc`（`export AZURE_DEVOPS_PAT=<token>`）
- 🔒 CI/CD：透過 GitHub Secrets 或 GCP Secret Manager 注入
- 🔒 PAT 權限最小化：Work Items Read+Write、Code Read+Write（**不可** Full Access）
- 🔒 PAT 至少每 90 天輪替一次
- 🔒 PAT 僅透過 `x-ado-pat` / `x-ado-org` header 傳遞，禁止出現在 URL / 日誌
- 🔒 PAT 不得進入 commit、log、PR description、tracker 留言、錯誤訊息

---

## 系統特有注意事項

### 1. 連線 / 認證

- ADO MCP 需要有效的 PAT
- PAT 存於 `~/.claude.json` 的 project-scoped `mcpServers.azure-devops.env.AZURE_DEVOPS_PAT`，或 `AZURE_DEVOPS_PAT` 環境變數
- 連線中途失敗 → 通知使用者並停止，**不可自動 fallback** 到 local-file（依協定）

### 2. 格式差異

- Work Item `description` / `AcceptanceCriteria` 接 **HTML**
- Work Item 留言寫入 `additionalFields["System.History"]`，接 **HTML**；skill 傳 Markdown，adapter 轉
- PR `description` 接 **Markdown**

### 3. 工具參數

- 所有 work item 操作（`get_work_item` / `update_work_item` / `create_work_item`）統一用 `workItemId`
- PR 操作用 `pullRequestId`
- `update_pull_request` 修改 reviewers / work items / tags 一律用 `addX` / `removeX` 對偶欄位，無裸 `reviewers` / `workItemRefs` 欄位

### 4. 限制

- `create_work_item` 與 `update_work_item` 是不同操作：新建子任務用前者，更新欄位 / 留言用後者
- `update_pull_request` 無 `autoCompleteSetBy` / `completionOptions` 參數；auto-complete 需手動於 ADO UI 設定
- 合併時的 work item 狀態轉移依 PR `description` 內的關鍵字（`Resolves #ID` 等）；WIT workflow rule 阻擋時跳過，需事後手動補
- 附件 URL 在同 ADO 組織內可跨 WI 引用，但跨組織不行
- API rate limit 約每 5 分鐘 200 個請求，批次操作須留意
