# Tracker Adapter 協定規格

本文件定義 Spex skills 與外部追蹤系統（Issue / Work Item Tracker）之間的抽象介面。
所有 spex-\* skills 僅使用此處定義的 **TRACKER 操作**，不直接呼叫任何 MCP 工具或讀寫特定系統。

> 路線命名原則：skills 應使用抽象路線名稱（例如 `需求路線`、`缺陷路線`），
> 原始 `type` 如何映射到路線，必須由各 adapter 文件定義，不能散落在 skills 內硬寫。

---

## Skills 引用 Adapter 規範

Skill 呼叫 `TRACKER.*` 時**不可載入整份 adapter 文件**，必須只讀對應章節。

**引用格式**：skill 引用協定章節（本檔 anchor），agent 執行時依 `.claude/rules/sdd-workflow.md` 的 `Tracker Adapter:` 對應到實際 adapter 檔的同名章節。

| 操作                        | 協定 anchor                                                                                          | 對應 adapter 章節名稱                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `TRACKER.readItem`          | [`#trackerreaditemid`](#trackerreaditemid)                                                           | `## \`TRACKER.readItem(id)\``                               |
| `TRACKER.findSpecComment`   | [`#trackerfindspeccommentid-phase`](#trackerfindspeccommentid-phase)                                 | `## \`TRACKER.findSpecComment(id, phase)\``                 |
| `TRACKER.addComment`        | [`#trackeraddcommentid-content`](#trackeraddcommentid-content)                                       | `## \`TRACKER.addComment(id, content)\``                    |
| `TRACKER.ensureBranch`      | [`#trackerensurebranchparams`](#trackerensurebranchparams)                                           | `## \`TRACKER.ensureBranch(params)\``                       |
| `TRACKER.createChildTask`   | [`#trackercreatechildtaskparams`](#trackercreatechildtaskparams)                                     | `## \`TRACKER.createChildTask(params)\``                    |
| `TRACKER.updateTaskState`   | [`#trackerupdatetaskstateid-state`](#trackerupdatetaskstateid-state)                                 | `## \`TRACKER.updateTaskState(id, state)\``                 |
| `TRACKER.getParentMetadata` | [`#trackergetparentmetadataid`](#trackergetparentmetadataid)                                         | `## \`TRACKER.getParentMetadata(id)\``                      |
| `TRACKER.getParentImages`   | [`#trackergetparentimagesid`](#trackergetparentimagesid)                                             | `## \`TRACKER.getParentImages(id)\``                        |
| `TRACKER.linkDependency`    | [`#trackerlinkdependencypredecessorid-successorid`](#trackerlinkdependencypredecessorid-successorid) | `## \`TRACKER.linkDependency(predecessorId, successorId)\`` |
| `TRACKER.getDependencies`   | [`#trackergetdependenciesparentid`](#trackergetdependenciesparentid)                                 | `## \`TRACKER.getDependencies(parentId)\``                  |

**Agent 讀取 SOP**：

1. `rg -n "^## .TRACKER\.<op>" <adapter-file>.md` → 取得起始行號
2. `rg -n "^## " <adapter-file>.md` → 從上一步行號往下找最近的 `^## ` 取得結束行號
3. 以 `sed -n '<起始>,<結束>p' <adapter-file>.md` 只讀該段
4. 跨章節依賴（例：`createChildTask` 需參考欄位格式）→ 各自重跑上述步驟

**例外**：首次接觸 adapter 可一次讀 `## 實作對應總覽 + ## 欄位格式約束`（通常 <100 行）取得全貌，不算違規。

---

## Adapter 選擇規則

Adapter 由 **`.claude/rules/sdd-workflow.md` 的 `Tracker Adapter:` 一行** 唯一決定。該規則檔由主代理於 session 啟動自動載入 context，skill 並會在執行時主動讀取（子代理不繼承主代理自動載入，故以主動讀為準）。

| 設定值       | 對應 adapter 文件                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `ado`        | [azure-devops/ado.md](./azure-devops/ado.md)                                                                   |
| `local-file` | [local-file.md](./local-file.md)                                                                               |
| 其他 id      | `.claude/reference/adapters/<id>.md` 或 `.claude/reference/adapters/<id>/<id>.md`（由 `/create-adapter` 建立） |

**規則：**

- 同一工作沿用記錄的 adapter；使用者要求切換時保留 ID／歷史對映
- 切換 adapter 只需修改 `.claude/rules/sdd-workflow.md` 那一行
- MCP 不可用時可用同 adapter 支援的 CLI／API；仍無法存取才記錄缺口、暫停依賴該系統的部分，獨立工作可繼續，不自動改用別的 tracker

---

## 檔案擺放規則

| 情況                                                | 擺放方式                                                           | 範例                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Adapter 為單一文件                                  | 平鋪：`.claude/reference/adapters/<id>.md`                         | `local-file.md`                                                 |
| Adapter 含子說明 / 擴充操作 / 範本 / 圖片處理等多檔 | 開子目錄：`.claude/reference/adapters/<id>/<id>.md` + 同層附屬文件 | `azure-devops/ado.md` + `azure-devops/ado-attachment-images.md` |

---

## 核心操作介面（10 個必填）

所有 adapter 必須實作以下 10 個操作。具體呼叫方式見各 adapter 文件。
不支援的必填操作 **不可刪章節**，須明示限制與替代方案。

| 操作                                                 | 用途                                  | 用在哪些 skill                                                                                         |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TRACKER.readItem(id)`                               | 讀 tracker item 基本資訊              | write-spec / fixbug / plan / task / implement / selfcheck / schedule                                   |
| `TRACKER.findSpecComment(id, phase)`                 | 找 `[Spex] <phase>` 留言         | fixbug / plan / task / implement / selfcheck / schedule                                 |
| `TRACKER.addComment(id, content)`                    | 寫結構化留言                          | write-spec（可選）/ fixbug / plan / task / implement / selfcheck / schedule（可選彙總） |
| `TRACKER.ensureBranch(params)`                       | 確保符合命名規則的分支存在並 checkout | plan（分類完成後）                                                                             |
| `TRACKER.createChildTask(params)`                    | 建立子任務                            | plan（直接實作的單張）/ task                                                                              |
| `TRACKER.updateTaskState(id, state)`                 | 更新任務狀態                          | implement / selfcheck                                                                                  |
| `TRACKER.getParentMetadata(id)`                      | 讀繼承欄位                            | plan / task                                                                                   |
| `TRACKER.getParentImages(id)`                        | 讀父任務描述內含圖片                  | task                                                                                                   |
| `TRACKER.linkDependency(predecessorId, successorId)` | 建立子任務間的依賴連結（前置 → 後繼） | task                                                                                         |
| `TRACKER.getDependencies(parentId)`                  | 讀子任務清單與依賴邊                  | implement / schedule 對帳                                                                      |

---

### `TRACKER.readItem(id)`

**讀取 tracker item / spec 的基本資訊。**

輸入：

- `id` — tracker item 的唯一識別碼

輸出（若無則該欄位回 `null`）：

```
{
  id: string | number,
  type: string,                  // 例：Feature / Bug / User Story
  title: string,
  description: string,
  state: string,                 // 例：To Do / In Progress / Done
  acceptanceCriteria: string | null,
  reproSteps: string | null,     // Bug 專用
  assignedTo: string | null,
  iterationPath: string | null
}
```

補充規則：

- `type` 保留各 tracker 系統的原始型別值
- skills 做路線分流時，應讀取 adapter 文件定義的「type → 路線」映射，**不可**在 skill 內假設 `Feature` / `Bug` 的意義

---

### `TRACKER.findSpecComment(id, phase)`

**在 tracker item 的歷程中搜尋特定 Spex 階段的結構化留言。**

輸入：

- `id` — tracker item ID
- `phase` — 階段名稱字串（`Spec` / `Fixbug` / `Plan` / `Task` / `Implement` / `Verify` / `Schedule`）

留言標題格式：`## [Spex] <phase> 完成`。
例外：`Verify` 階段有兩種標題——`## [Spex] Verify 完成`（PASS）與 `## [Spex] Verify Fail`（FAIL），搜尋 `Verify` 時兩者皆須匹配（比對前綴 `## [Spex] Verify`）。

多筆符合時回**最新一筆**（selfcheck 重做迴圈會產生多筆 Verify 留言，判定一律以最新為準）。

輸出：

```
{
  found: boolean,
  content: string | null
}
```

`found: false` → 先檢查實際 tracker／工作樹並補做缺少的必要階段；只有缺少無法推導的資訊才詢問，不杜撰完成紀錄。

---

### `TRACKER.addComment(id, content)`

**新增結構化留言到 tracker item。**

輸入：

- `id` — tracker item ID
- `content` — 留言 Markdown 文字（各 skill 自行定義格式，首行需含 `## [Spex] <phase> 完成`；Verify 失敗時為 `## [Spex] Verify Fail`）

輸出：

```
{
  success: boolean,
  commentId: string | null
}
```

> 已授權工作依「寫入與授權」直接執行並留存結果。

---

### `TRACKER.ensureBranch(params)`

**確保符合 SDD workflow 規則「分支生命週期」命名規則的本地分支存在並 checkout。直接執行，不需使用者確認。**

先沿用使用者指定或 tracker 已記錄的工作／排程分支。只有新建時才用 workflow 的 Branch Naming，預設 `codex/<adapter>-<id>-<summary>`；adapter 前綴只作識別，不覆蓋使用者指定的命名。

輸入：

```
params: {
  id: string | number,                              // tracker item ID
  type: 'feature' | 'fix' | 'chore' | 'refactor',
  summary: string,                                  // kebab-case 摘要
  baseBranch?: string                               // 未提供則自動解析（見下）
}
```

baseBranch 解析順序（未提供時）：

1. 依序檢查本地存在的分支：`dev` → `develop` → `development`
2. 全部找不到 → 回 `success: false, reason: "no default base branch found (dev / develop / development)"`，**不可** fallback 到 `master` / `main`

行為：

1. 先找本工作既有分支；無既有分支才組新名稱 `codex/<adapter>-<id>-<summary>`。批次沿用同一共用分支。
2. `git branch --show-current` 已等於目標分支 → no-op，回 `created: false`
3. 本地已存在但未 checkout → `git checkout <branch>`，回 `created: false`
4. 本地不存在 → 從解析後的 baseBranch `git checkout -b <branch>`，回 `created: true`
5. git 操作失敗（含 dirty tree 衝突） → 回 `success: false, reason: <git stderr>`

輸出：

```
{
  success: boolean,
  branchName: string,
  baseBranch: string,
  created: boolean,
  reason: string | null
}
```

---

### `TRACKER.createChildTask(params)`

**建立子任務並連結到父 tracker item。**

輸入：

```
params: {
  parentId: string | number,
  title: string,                // 格式：[T-XXX] <任務名稱>
  assignedTo: string | null,    // 繼承自父 item
  iterationPath: string | null, // 繼承自父 item
  description: string,          // 任務描述（含檔案清單、TDD 步驟）
  acceptanceCriteria: string    // 驗收標準與驗證指令
}
```

輸出：

```
{
  success: boolean,
  childId: string | number | null
}
```

> 已授權工作依「寫入與授權」直接執行並留存結果。

---

### `TRACKER.updateTaskState(id, state)`

**更新任務狀態。**

輸入：

- `id` — Task、Story 或 Epic 的 tracker ID；local child ID 另由呼叫端明確提供父卡上下文
- `state` — 抽象狀態：`in-progress` / `done` / `removed`

adapter 必須定義「抽象狀態 → 系統狀態字串」映射表。Task 相關驗證通過可 done；Story 實作完成仍 in-progress、記「待 Epic 驗收」並可解除後續實作依賴；Epic 集中驗收通過後才同步 Epic 與納入 Story 為 done。無 Epic 的獨立 Story 自行作為驗收單位。done 不代表已整合上線。

輸出：

```
{
  success: boolean
}
```

---

### `TRACKER.getParentMetadata(id)`

**讀取父 tracker item 的繼承欄位。**

輸入：

- `id` — 父 tracker item ID

輸出：

```
{
  assignedTo: string | null,
  iterationPath: string | null
}
```

---

### `TRACKER.getParentImages(id)`

**讀取父 tracker item 描述內含的圖片附件清單。**

輸入：

- `id` — 父 tracker item ID

輸出：

```
[
  {
    alt: string,    // 原始 alt 文字或 URL-decoded 檔名
    html: string    // 可直接嵌入子任務 description 的 HTML 片段
  }
]
```

無圖片 → 回傳空陣列 `[]`。
系統不支援附件 → 仍實作此操作但永遠回 `[]`。

---

### `TRACKER.linkDependency(predecessorId, successorId)`

**建立兩個子任務之間的依賴連結：`predecessorId` 完成後 `successorId` 才可開始。**

輸入：

- `predecessorId` — 前置子任務 ID
- `successorId` — 後繼子任務 ID

輸出：

```
{
  success: boolean,
  reason: string | null
}
```

行為規則：

- **冪等**：連結已存在 → 視為成功（`success: true`），不報錯
- 兩個 ID 必須屬於同一個父 item 的子任務；跨父卡連結 → `success: false` 並說明
- 系統不支援原生依賴連結 → 仍實作此操作，於 adapter 文件標明限制，改以任務留言「依賴」欄為事實來源

> 已核准的依賴邊直接建立；回讀確認連結成功。

---

### `TRACKER.getDependencies(parentId)`

**讀取父 item 的全部子任務與其依賴邊，供實作（implement）建立執行 DAG 與排程（schedule）對帳。**

輸入：

- `parentId` — 父 tracker item ID

輸出：

```
{
  tasks: [
    {
      childId: string | number,
      title: string,        // 含 [T-XXX] 前綴的原始標題
      state: string         // 系統原始狀態字串
    }
  ],
  edges: [
    {
      predecessorId: string | number,
      successorId: string | number
    }
  ]
}
```

行為規則：

- 無子任務 → `tasks: []`
- 子任務間無依賴連結 → `edges: []`（skill 據此 fallback 到 Task 留言的「依賴」欄）
- 不在此操作內做循環檢查——DAG 驗證由呼叫端 skill 負責

---

## `TRACKER.recordBenchmark(params)`

> **選用操作，非 10 必填核心**；內建 skill 沒有固定呼叫者，保留供專案自訂 skill 使用。adapter 可不實作（未實作 → 回 `success: false`，由呼叫方 fallback 為輸出 Markdown 供使用者手動貼上）。未列入頂部「Skills 引用 Adapter 規範」10 核心對照表；呼叫方以 rg SOP 直接讀 adapter 的同名章節。

**把 SDD 基準 / 成本紀錄寫入「會渲染表格與可勾選 to-do」的載體（report 頁 / 文件內文 body）。** 與 `addComment` 的關鍵差異：目的地必須**渲染** Markdown 表格與 `- [ ]` to-do——只能保留純文字、不渲染的留言類載體**不可**用於本操作。

輸入：

```
params: {
  target: string,              // 目的地識別（頁面 URL / UUID / 本機檔路徑；由 adapter 自解釋）
  content: string,             // Markdown（含表格與 `- [ ]` 可勾 to-do）
  mode: 'append' | 'replace'   // append = 追加新區塊；replace = 覆寫目的地
}
```

輸出：

```
{
  success: boolean,
  url: string | null,          // 寫入後的頁面 / 檔案連結
  reason: string | null
}
```

行為規則：

- 必須寫到**會渲染**的載體（如頁面內文 body）；不可退化為不渲染的留言。
- 目的地不存在 / 系統不支援渲染表格與 to-do → 回 `success: false` + `reason`，由呼叫方 fallback。
- adapter 文件必須在對應章節說明 `target` 接受的形式與 `append` / `replace` 的實作方式。

> 已授權工作依「寫入與授權」直接執行並留存結果。

---

## 擴充操作（可選）

當 tracker 系統有抽象介面無法覆蓋的特殊能力（附件下載、批次匯入、特殊查詢等），adapter 可宣告 **擴充操作**。

**必須使用系統前綴命名空間**，不可佔用 `TRACKER.*`：

| adapter       | 擴充操作範例                  |
| ------------- | ----------------------------- |
| ADO           | `ADO.readAttachment(url)`     |
| GitHub Issues | `GITHUB.searchByLabel(label)` |
| Jira          | `JIRA.linkEpic(epicId)`       |
| Linear        | `LINEAR.cycleQuery(cycleId)`  |

skills 不會自動呼叫擴充操作；只有引用該 adapter 的 skill 才可選擇性使用。

---

## 寫入與授權

已授權範圍內的計畫、留言、子卡、依賴與狀態更新可直接執行；記錄實際結果並回讀 ID，不逐階段或逐筆要求確認。必要資訊缺失或新增 scope 才向使用者詢問。

master 合併與推送依 `.claude/rules/sdd-workflow.md` 的 Branch Policy：必須有使用者對該 Epic／批次的明確授權，既有授權有效。agent 自行填寫的狀態或旗標不構成授權。adapter 不額外安裝無條件工具封鎖。

---

## 欄位格式約束

各 adapter 須在文件中明示每個寫入欄位接受的格式（HTML / Markdown / Plain），避免 skill 傳錯型。

常見差異：

- 同系統內不同欄位格式可能不同（如 ADO 的 work item description = HTML，title = Plain text）
- 留言可能會被自動渲染（如 ADO Markdown → HTML）

adapter 須以表格列出全部寫入欄位的格式，作為 skill 寫入時的參考。

---

## 規格建卡欄位對照（write-spec 專用，協定強制）

`spex-write-spec` 建立頂層規格項目時，必須讀取當前 adapter 文件的「規格建卡欄位對照」章節取得欄位/型別/預設 workspace-or-project 對照，**不可**在 skill 內硬寫任何特定 tracker 的欄位名稱（如 ADO 的 `Microsoft.VSTS.Scheduling.Effort`）或工作項目型別預設值。

每個 adapter 文件必須包含此章節，內容二選一：

1. **支援頂層規格建卡**：欄位對照表（抽象欄位 → 系統欄位名稱、型別選擇、org/project 或等效預設值），必要時附一個該系統實際建卡呼叫的範例。
2. **不支援，僅子任務**：明講「此 tracker 不支援建立頂層規格項目，僅能建立子任務（`TRACKER.createChildTask`）」，不可留白或省略此章節。

---

## ID 格式說明

| Adapter    | ID 格式             | 範例                        |
| ---------- | ------------------- | --------------------------- |
| ADO        | 數字                | `1234`                      |
| Local File | `<YYYYMMDD>-<slug>`，由實際目錄回讀 | `20260904-ragforge-chunk-annotations` |

ID 依 adapter 的實際回傳或 filesystem 回讀取得；建立時依已核准標題產生可讀 slug，不因未手填 ID 要求額外確認。

---

## 擴充新 Adapter

1. 透過 `/create-adapter` 建立 `.claude/reference/adapters/<id>.md` 或 `.claude/reference/adapters/<id>/<id>.md`
2. 實作全部 10 個必填 `TRACKER.*` 操作（不支援的 → 標限制、不刪章節）
3. 視需要宣告擴充操作（系統前綴命名空間）
4. 更新本文件「Adapter 文件清單」
5. 各 skill **無需修改**，因為只使用抽象介面

---

## Adapter 文件清單

| 文件                             | 對應系統                       | 狀態      |
| -------------------------------- | ------------------------------ | --------- |
| [ado.md](./azure-devops/ado.md)  | Azure DevOps                   | ✅ 可用   |
| [local-file.md](./local-file.md) | 本機 specs/ 目錄（無 Tracker）  | ✅ 可用   |
| `github-issues.md`               | GitHub Issues                  | 🔲 待實作 |
| `jira.md`                        | Jira                           | 🔲 待實作 |
