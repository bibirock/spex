# Tracker Adapter — Local File（無 Tracker 模式）

本文件為 Local File adapter，由 workflow 設定明確選用；不因其他 tracker 暫時斷線自動切換。
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
      escalation.md            ← 實作待處理事項（兜底落點，見 addComment）
      verify.md                ← [Spex] Verify 完成 / Verify Fail（逐輪保留）
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
| ID → 路徑 | 以 `^(\d{8})-(.+)$` 拆解：group 1 為日期層、group 2 為任務層 → 先查 `specs/<日期>/<slug>/`；不存在則 fallback 查 `specs/_archive/<日期>/<slug>/`（封存區，見「擴充操作 › `LOCALFILE.archiveDoneSpecs()`」）；兩者皆不存在才視為卡片不存在 |
| 路徑 → ID | 日期層目錄名 + `-` + 任務層目錄名（`_archive/` 只是路徑上多出的根目錄層，不算日期層，組 ID 時忽略） |

- **不需 glob**：任何操作拿到 ID 都能直接組出路徑再讀檔（含上述兩步 fallback）。
- **唯一性由結構保證**：同名 slug 落在不同日期不會撞名，不必額外靠人工規矩維護唯一性。
- **slug 格式**：小寫英數字與連字號，不含空格與底線；不可以 8 位數字開頭（否則拆解會誤判日期層）。
- ID 從實際建立的目錄回讀，不用推算值代替 tracker 事實。
- **封存 fallback 適用範圍**：本表的 ID → 路徑 fallback 是唯一事實來源。`readItem` / `findSpecComment` / `addComment` / `getParentMetadata` / `getParentImages` / `createChildTask` / `updateTaskState`（含其內部 `tasks/`、`tasks-state.json`、`attachments/` 等子路徑組裝）一律套用同一條規則解析任務資料夾根，不在各自章節重複宣告 fallback 邏輯——只需在「解析任務資料夾根」這一個共用步驟套用兩段式查找即可。`ensureBranch` 不受影響——分支名只吃 ID 字串，從不組路徑。

### ⛔ 日期層永不搬移

日期是**建卡日**，資料夾建立後**不隨工作日變動**。同一張卡跨多天推進仍留在原資料夾。

理由：ID 由路徑推導，搬資料夾等於換 ID——已建立的分支名（`feature/LOCAL-<id>-…`）、已寫入的留言引用、commit 訊息內的 ID 會全部失聯。要按「當前工作日」瀏覽請用 `git log` 或編輯器搜尋，不要動目錄。

（封存操作搬的是「根目錄層」`specs/` → `specs/_archive/`，不是搬日期層或任務層——`<日期>` 與 `<slug>` 這兩個組成 ID 的字串本身不變，ID 字串因此不變，不牴觸本節規則。見「擴充操作 › `LOCALFILE.archiveDoneSpecs()`」。）

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
- **不覆寫既有 entry**。實作修復、驗收複核或格式修正都追加新筆，保留原始證據與判定供追溯。

### 讀取 SOP（取最新一筆）

先以 `rg -n '<!-- spex:entry' <檔案>` 列出 marker，解析所有數值 seq，讀取最大 seq 的完整 entry，不假定檔案物理順序。無 marker 的舊檔以既有標題區塊讀取，保留原文；追加第一筆新格式紀錄時不得刪掉歷史。

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

無工作量欄位的原生支援，write-spec 的估點結果直接以 Markdown 章節保存（見 `spec-template.md` 的「預估開發點數」章節格式），不強行對應到 Front Matter。

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
| `"Schedule"`              | `schedule.md`       |
| `"Schedule 批次分支"`     | `schedule-branch.md` |

**若檔案不存在：**

- 回傳 `{ found: false, content: null }`；呼叫端先檢查是否已有等效工作紀錄，再補做必要階段。缺少使用者才能提供的資訊才詢問。

**若檔案存在：**

- 回傳 `{ found: true, content: "<最新一筆 entry 的內容，不含 spex:entry 標記行>" }`
- 需要歷史筆數（對帳、輪次追溯）時另讀整檔，但一般階段判定只取最新一筆。

---

## `TRACKER.addComment(id, content)` → Local File 實作

把 `content` 以**新 entry prepend** 到對應階段檔（不覆寫既有內容）。

**由 skill 傳入的 `content` 第一行決定寫入目標。** 比對規則：取第一行、剝除標題後可能附加的標記後綴，再比對下表：

| 留言標題                                          | 寫入檔                |
| ------------------------------------------------- | --------------------- |
| `## [Spex] Spec 完成`                             | `spec.md`             |
| `## [Spex] Fixbug 完成`                           | `fixbug.md`           |
| `## [Spex] Plan 完成`                             | `plan.md`             |
| `## [Spex] Task 完成`                             | `task.md`             |
| `## [Spex] Task 子卡對照`                         | `task-children.md`    |
| `## [Spex] Implement 完成`                        | `implement.md`        |
| `## [Spex] Verify 完成` / `## [Spex] Verify Fail` | `verify.md`           |
| `## [Spex] Schedule 完成`                         | `schedule.md`         |
| `## [Spex] Schedule 批次分支`                     | `schedule-branch.md`  |
| **上表皆不符**                                    | `escalation.md`（兜底） |

**關於兜底落點**：待處理事項或新的留言型別可能沒有固定的 `[Spex]` 標題。這些一律寫進 `escalation.md`（同樣 append-only），**不得靜默丟棄**——寫入後於回報中明列「已落 escalation.md（未匹配既有 phase）」，讓使用者知道有一筆非標準留言，必要時再回本 adapter 補對照。

寫入步驟：

1. 依「ID 規則」定位任務資料夾；不存在 → 回 `{ success: false, reason: "item not found" }`（不自動建卡）
2. 目標檔不存在 → 以 `seq=1` 建檔；存在 → 掃描全部 `spex:entry` marker 並取數值最大的 `seq`（不得假設第一個或最後一個 marker 必然最新），新 entry 用 `seq+1`
3. 在**檔首** prepend：`<!-- spex:entry seq=<n> at=<ISO8601> -->`＋空行＋`content`＋空行，原有內容接在後面

格式、路徑或摘要錯誤直接追加修正版並指向被修正的 seq 與原因，不增加產品失敗次數。實際缺陷與驗收判定仍須真實記錄，不補造 PASS。

已授權範圍內直接寫入並回報結果，不逐筆要求使用者確認。

---

## `TRACKER.ensureBranch(params)` → Local File 實作

依 [協定 ensureBranch](./README.md#trackerensurebranchparams) 執行純本地 git 操作。優先沿用使用者指定／tracker 已記錄的工作或批次分支，包括既有 `chore/schedule-*` 與 `feature/LOCAL-*`；新建才用 `codex/local-<id>-<summary>`。

確實回報 git 錯誤；有其他未提交工作時可使用隔離 worktree，不擅自 reset、stash 或刪檔。push／整合由授權工作流程處理，不綁定另一個 skill。

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

Task ID 必須連同父卡上下文定位，不能跨目錄猜測同名 T-001。兩處必須同步並回讀；只改一處會讓 `getDependencies` 與子卡檔說法不一致。

`id` 若為完整 Story／Epic ID，依 ID 規則修改該 `item.md` 的 `state`。Story 實作完成保持 `in_progress`，在 implement.md 記「待 Epic 驗收」；Epic Verify PASS 後才把 Epic 與納入 Story 設 done。此狀態不表示已合併或上線。

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

對已授權計畫中的依賴直接建立並回讀，不逐邊確認。

---

## `TRACKER.getDependencies(parentId)` → Local File 實作

讀取 `specs/<日期>/<slug>/tasks-state.json` 與 `tasks/` 下各任務檔組裝回傳：

1. `tasks`：遍歷 `tasks-state.json` 的 `tasks` 映射，鍵即 `childId`，取其 `state`；`title` 自對應 `tasks/<childId>.md` 的 Front Matter `title`
2. `edges`：把 `dependencies` 陣列逐筆轉成 `{ predecessorId: <predecessor>, successorId: <successor> }`
3. 無 `dependencies` 鍵或為空 → `edges: []`（呼叫端 fallback 到 Task 留言「依賴」欄）

---

## 擴充操作

local-file adapter 特有、`TRACKER.*` 10 核心操作未涵蓋的能力，依 `adapters/README.md`「擴充操作」規範以系統前綴命名空間宣告。skills 不會自動呼叫；只有明確引用本章節的 skill／人工操作才會使用。

### `LOCALFILE.archiveDoneSpecs()`（封存 done 卡片）

**用途**：把 `item.md` Front Matter `state: done` 的任務資料夾，從 `specs/<日期>/<slug>/` 搬到 `specs/_archive/<日期>/<slug>/`——只搬「根目錄層」（`specs/` → `specs/_archive/`），`<日期>` 與 `<slug>` 兩段路徑原樣照搬，因此組出的 ID 字串 `<日期>-<slug>` 不變（見「ID 規則 › 封存 fallback」）。目的是讓 `specs/<日期>/` 主列表只留未完成任務，同時保留已完成卡片的完整歷史與可定位性。

**呼叫時機**：僅在使用者要求封存，且該卡已完成驗收與本次要求的整合、無在途引用時使用。done 只代表驗收完成，不能據此自動搬移；批次腳本不檢查整合狀態，呼叫端先 dry-run 核對全部候選，必要時使用 --id 限定。

**實作**：[`scripts/archive-done-specs.sh`](./scripts/archive-done-specs.sh)。

```bash
bash .claude/reference/adapters/scripts/archive-done-specs.sh --dry-run   # 先看清單，不搬
bash .claude/reference/adapters/scripts/archive-done-specs.sh             # 正式搬（git mv，staged 但不 commit）
```

**目錄結構變化**：

```diff
 specs/
   20260814/
-    relax-query-retrieval/
-      item.md
-      spec.md
   20260815/
     feat-login/
       ...
+  _archive/
+    20260814/
+      relax-query-retrieval/
+        item.md
+        spec.md
```

**演算法**：

1. 掃描 `specs/*/`，排除 `_archive/` 本身；只認資料夾名符合 `^\d{8}$` 的日期層（其餘一律略過，不報錯——避免誤動使用者自建的雜項目錄）
2. 每個 `specs/<日期>/<slug>/item.md`：讀 Front Matter `state:` 值（沿用 grep+offset 慣例，非真 YAML parser）
3. 依判定分流（見下方狀態表）
4. 命中「可封存」→ `mkdir -p specs/_archive/<日期>/` 後 `git mv specs/<日期>/<slug> specs/_archive/<日期>/<slug>`（用 `git mv` 而非 `mv` + `git add`/`git rm`，保留 blame / `git log --follow` 歷史）
5. 每筆印一行報告；退出碼一律 0（報告型工具，非硬 gate）

**狀態表**：

| 判定 | 條件 | 行為 |
| --- | --- | --- |
| `ARCHIVED` | `state: done` 且目的地不存在且無未提交變更 | 執行 `git mv`（staged，不自動 commit） |
| `SKIP not-done` | `state` 非 `done`（含空值） | 略過 |
| `SKIP already-archived` | `specs/_archive/<日期>/<slug>/` 已存在 | 略過（冪等的來源） |
| `SKIP dirty-worktree` | 該任務資料夾內 `git status --porcelain` 非空 | 略過，不強搬 |
| `SKIP no-item-md` | 找不到 `item.md` | 略過（非標準任務資料夾） |

**未提交變更（dirty-worktree）處理**：搬移前一律先跑 `git status --porcelain -- specs/<日期>/<slug>`；只要該資料夾內有任何未追蹤或未提交的變更，一律跳過、不強制搬移——直接搬移會讓「這批變更是搬移前還是搬移後產生」變得不可考，也可能讓使用者弄丟尚未 commit 內容的位置。要封存該卡，請先自行 commit 或 stash 該資料夾內的變更後重跑。

**不自動 commit**：腳本以 git mv stage 搬移，呼叫端核對清單後依任務授權提交。

**在途引用**：封存前檢查其他分支／worktree 是否仍會修改或引用該路徑，避免 rename/modify 衝突；僅本工作樹乾淨不能證明其他工作已整合。

### `LOCALFILE.archiveItem(id)`（單卡變體，選用）

同一支腳本、`--id` 旗標：

```bash
bash .claude/reference/adapters/scripts/archive-done-specs.sh --id=20260814-relax-query-retrieval
```

只處理指定 ID 對應的單一任務資料夾；仍套用上表全部判定（非 `done` 一律 skip，**不會**因為指定了 `--id` 就強制封存未完成的卡）。用途：已核對驗收、整合及在途引用後，只封存指定卡而不觸發全庫搬移。**非必要操作**——目前沒有任何 skill 會呼叫它，`archiveDoneSpecs()` 全掃描已能滿足「一次性遷移＋日後重跑」的完整需求；保留只因實作成本極低（共用同一支腳本）。

#### 注意事項

- 只信任 `item.md` 自己的 `state` 欄位，不檢查子任務（`tasks/*.md`）是否全部 `done`——與 `readItem` 的既有行為一致，父卡 `state` 是唯一事實來源。
- 腳本可在 repo 內任何目錄執行，會自動 `cd` 到 `git rev-parse --show-toplevel`；不在 git 工作樹內或找不到 `specs/` 一律印錯誤並以非 0 結束（唯二的非 0 退出情境，其餘一律 0）。
- 不引入 YAML parser——沿用本文件其餘章節的 grep+offset 讀法。

---

## Local File 特有注意事項

1. **日期層永不搬移** — 見上方「ID 規則」。搬資料夾等於換 ID，會讓分支名、留言引用、commit 內的 ID 全部失聯。
2. **留言 append-only，不覆寫** — 保留實作、修復與驗收原始紀錄，當前狀態依最新有效證據判斷。
3. **未匹配的留言落 `escalation.md`，不得靜默丟棄** — 並於回報中明列，讓使用者有機會回本 adapter 補對照。
4. **slug 不可以 8 位數字開頭** — 會讓 `^(\d{8})-(.+)$` 誤判日期層。
5. **無網路環境** — Local File Adapter 完全不需要網路。適合離線開發或 ADO 連線不穩的情況。
6. **版本控制** — `specs/` 目錄建議納入 `git` 版本控制，方便團隊分享 Spex 產出。
7. **迭代路徑的替代** — 無 ADO 時 `iterationPath` 無意義，可填入 Sprint 名稱或留空。
8. **封存（`specs/_archive/`）** — 已核對驗收、整合與在途引用的 `state: done` 卡片可用 `LOCALFILE.archiveDoneSpecs()`（[`scripts/archive-done-specs.sh`](./scripts/archive-done-specs.sh)）搬到 `specs/_archive/<日期>/<slug>/`。只搬根目錄層，日期層與任務層字串不變，ID 因此不變——不牴觸「日期層永不搬移」。搬移用 `git mv` 保留歷史，且只在 `git status --porcelain` 乾淨時才搬；掃描時 `_archive/` 本身會被排除，不會被誤判成新的日期層。詳見「ID 規則 › 封存 fallback」與「擴充操作 › `LOCALFILE.archiveDoneSpecs()`」。
