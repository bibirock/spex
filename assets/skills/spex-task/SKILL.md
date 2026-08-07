---
name: spex-task
description: 根據 tracker 相關留言區的 task 把實作工作拆解成可執行的 TDD 任務清單。用於垂直切片、定義 TDD 驗收標準，開卡後把任務依賴寫入 tracker 原生連結。前置：spex-plan（Tier 2）。後續：spex-implement。（Tier 1 輕量任務不走本 skill，由 spex-plan 直接開單張 Task 卡）
---

# Spex: Task — 任務分解

**拆解過程不輸出，直接回寫 TRACKER**
**拆解過程不輸出，直接回寫 TRACKER**
**拆解過程不輸出，直接回寫 TRACKER**

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，**禁止整檔載入**。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 0 讀 tracker item |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 0 找 Plan 留言 |
| [`TRACKER.getParentMetadata`](../../reference/adapters/README.md#trackergetparentmetadataid) | Phase 5 取繼承欄位 |
| [`TRACKER.getParentImages`](../../reference/adapters/README.md#trackergetparentimagesid) | Phase 5 取父任務圖片 |
| [`TRACKER.createChildTask`](../../reference/adapters/README.md#trackercreatechildtaskparams) | Phase 5 建子任務 |
| [`TRACKER.linkDependency`](../../reference/adapters/README.md#trackerlinkdependencypredecessorid-successorid) | Phase 5.4 寫入依賴連結 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 5 寫留言 |

## 規則載入與記憶快取（最先執行）

依 adapters/README.md 的 grep+offset SOP 主動讀取所需章節（章節 grep 不到 → fallback 整檔讀），不依賴編輯器自動載入：

- `.claude/rules/sdd-workflow.md` — 「核心原則」「Branch Naming」「分支生命週期」「架構與路徑映射」「File Zones」「對抗式詰問」「章戳鏈（蓋章 / 驗章）」章節；批次驅動時另讀「spex-schedule 批次模式互動確認規則」「多 Repo 執行紀律」「ID 事實鐵則」章節
- `.claude/rules/commands.md` — 整檔（驗證指令束）
- `.claude/rules/testing.md` — 「測試框架」「測試檔結構」章節（撰寫 Red 測試的依據）

探索結果寫入 memory（`type: project`，檔名固定 `sdd-rules-cache.md`，同 key 更新不新增）供下次取用；與當前規則檔不符時以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-task` 的 `active` 教訓，把其「防護」納入本輪拆卡 / AC 設計注意點；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

技術領導角色，把技術計畫拆為可執行的 TDD 任務清單。**應用垂直切片：每個任務代表一條完整使用者路徑。**

## When to Use

- ✅ Plan 已確認，準備編碼（Tier 2）
- ✅ 需明確任務清單
- ✅ 需建立 tracker 子任務
- ❌ Plan 未完成（`spex-plan`）
- ❌ 單層改動無需拆解（Tier 1：由 `spex-plan` 直接開單張 Task 卡）

---

## Process

### Phase 0: 上下文判斷（強制最先）

| 條件 | 動作 |
|---|---|
| 對話已含 Plan 產出（技術棧 + 架構 + 預計修改檔案 + tracker ID） | 直接進 Phase 1 |
| 對話無 Plan 資訊 | 先自動取 ID：執行 `git branch --show-current`，依 SDD workflow 規則的「Branch Naming」格式解析 tracker item ID（符合自動化流程，不需詢問）；不符才向使用者詢問 ID。取得後 → `TRACKER.readItem(id)` + `TRACKER.findSpecComment(id, "Plan")` 取出 `### 技術棧 / 架構設計 / 預計修改檔案 / 成功條件（量化） / 驗收標準（來自規格）` |
| `findSpecComment` 回 `found: false` | 停止 → 「請先執行 `spex-plan`」 |

---

### Phase 1: 前置條件確認

**分支驗證（強制最先）：** 執行 `git branch --show-current`，必須符合 SDD workflow 規則的「Branch Naming」定義的命名格式與驗證 regex。不符 → 停止，依 SDD workflow 規則的「分支生命週期」處理。

- ✅ 分支符合命名規則
- ✅ 技術架構 / 元件拆分 / 資料流（Plan 產出）
- ✅ 驗收標準已定義

---

### Phase 2: 讀取前置資訊

從對話理解：

- 技術計畫的檔案結構與元件拆分
- 驗收條件（每條 AC 必須有對應任務）
- SDD workflow 規則的「核心原則 / MVP 優先」（任務不得超出 MVP）

---

### Phase 3: 任務識別 — 垂直切片

每個切片是一條完整使用者路徑，跨越全棧：

```
[使用者動作]
  → [API / 資料層]
  → [狀態 / 業務邏輯層]
  → [UI 元件層]
  → [畫面更新]
= 一個 Task（垂直切片）
```

**任務類型：**

| 等級 | 用途 |
|---|---|
| Foundation Type | 跨切片共用型別；無依賴；優先 |
| Foundation Test | 測試工具 / mock 設置；優先 |
| Vertical Slice | 完整端到端使用者故事（API → Store → Logic → UI） |

❌ 不可水平分層（「Task 1: 所有 Types」「Task 2: 所有 Services」等）

---

### Phase 4: 產生任務清單

產生後回寫 TRACKER：

````
# 任務清單 — <功能>

> Tracker Item: <ID> | 階段: Task | Tier: <1/2> | 日期: <DATE>
> 切片方式: 垂直

## 任務摘要
| Task ID | 名稱 | 等級 | 依賴 | 狀態 |
|---|---|---|---|---|
| T-001 | <型別名稱> | Foundation | — | ⬜ |
| T-002 | <完整路徑> | Vertical | T-001 | ⬜ |
| T-003 | <完整路徑> | Vertical | T-001 | ⬜ |

---

## T-001 — <任務名稱>
**等級**: Foundation Type | **依賴**: — | **對應 AC**: AC-01, AC-02

### 描述
<跨切片共用型別 / 基礎設施>

### 包含檔案
1. `<型別層>/<domain>.<ext>` — 共用型別（< 50 行）
2. `<測試層>/<domain>.spec.<ext>` — 型別驗證（若需要）

### AC
- [ ] 型別完整無裸 any（依 SDD workflow 規則的「核心原則 / 型別安全」）
- [ ] interface / struct 有說明文件
- [ ] 可被後續任務 import
- [ ] 通過型別檢查

### 驗證
依 commands 規則 型別檢查指令

---

## T-002 — <完整路徑>
**等級**: Vertical Slice | **依賴**: T-001 | **對應 AC**: AC-01, AC-02

### 描述
<完整使用者路徑，例：點擊提交 → API → Store 更新 → 顯示成功>

### 參考圖片（來自父任務）
> 列出與本任務直接相關的圖片（alt / 檔名）。Phase 5 依此決定嵌入哪些圖片。無則填「無」。

- `<圖片 alt>` — <說明相關性>

### 包含檔案（路徑依 SDD workflow 規則的「架構與路徑映射」與「File Zones」）
1. `<API/資料層>/<service>.<ext>`
2. `<狀態管理層>/<module>.<ext>`
3. `<業務邏輯層>/<feature>.<ext>`
4. `<UI 層>/<Component>.<ext>`

### TDD 流程

🔴 **Red** — 依 AC 寫失敗測試（規劃階段只寫不跑：測試尚未實作、必然失敗；**執行期由 `spex-implement` Phase 3B 跑一次確認失敗原因符合 AC**）：
```
// <測試層>/<Component>.spec.<ext>
describe('<Component>', () => {
  it('AC-01: ...', async () => {
    // Arrange / Act / Assert
  })
})
```

🟢 **Green** — 寫最小可讓測試通過的實作。執行測試確認 PASS。

🔵 **Refactor** — 確保：
- 無重複邏輯（DRY）
- 命名清晰
- 型別安全（依 SDD workflow 規則的「核心原則 / 型別安全」）
- 移除「以後可能會用到」
- 必要的行內註解

再次執行測試確認仍 PASS。

### AC
- [ ] AC-01 通過：<具體條件>
- [ ] AC-02 通過：<具體條件>
- [ ] 測試覆蓋率 ≥ 80%（業務邏輯）
- [ ] lint / typecheck 通過
- [ ] 單一檔案 < 200 行

### 驗證
依 commands 規則 驗證指令束（test / typecheck / lint / dev）

---

## T-003 — <另一條路徑>
（同 T-002 格式）

---

## 守則

| 守則 | 規則 |
|---|---|
| 垂直切片 | 每任務為一條完整使用者路徑，禁止水平分層 |
| MVP | 任務含「以後可能會用到」→ 立即刪除；後續需求新建 tracker item |
| TDD | 若先寫實作（非 R→G→R），PR description 註明原因並標 `[non-tdd]` |
````

---

### Phase 4.5: 確定性 lint + 對抗式詰問（開卡前硬閘門）

> **未過本閘門不得開卡、不得寫留言。** 依 `.claude/rules/sdd-workflow.md`「對抗式詰問」「章戳鏈（蓋章 / 驗章）」。

#### 4.5.1 確定性 lint（機器先行，零 LLM 成本）

把 Phase 4 的任務清單草稿落到 `spex-temp/task-draft.md`（目錄 on-demand，讀完 `rm -rf`），執行：

```
node .claude/reference/spex/scripts/task-draft-lint.mjs spex-temp/task-draft.md
```

exit ≠ 0 → 依違規清單修正草稿後重跑，**不進詰問**（別讓 challenger 燒在機器就能抓的格式問題上）。

規則以框架中性者為主（TDD 段的測試執行確認、AC 須帶驗收指令、包含檔案須帶說明、禁行數／工時預估）；另有兩條**選擇性觸發**規則（測試名 pattern 與多狀態碼 AC），草稿沒用到該語法就完全不檢查——不帶參數執行腳本可看到完整規則清單。

#### 4.5.2 派發 challenger

呼叫 `.claude/skills/spex-challenge/SKILL.md`，stage = `task`、round = 本輪輪次。

- **圍欄內容（`challenge-draft`）＝ Phase 4 的任務清單草稿本體逐字**——即之後要寫進 Task 留言的內容。**絕不含**引章宣稱行、`## challenge：` 佔位標題，也**不含任何真實子卡 ID**（此時尚未開卡；ID 事實走 Phase 5.5 的獨立留言，不進章的綁定範圍）。
- 詰問輸入另附：規格原文、Plan 留言、證據包（預計修改檔案清單、關鍵決策的 `file:line` 出處）。
- **禁止**餵入本次拆卡的推理過程與對話歷史。

#### 4.5.3 判定

| 結果 | 動作 |
|---|---|
| challenger 章面 `verdict=PASS` | 記下章號（`tool_use_id` 或回傳的 `agentId`）→ 進 Phase 5 |
| 任一 FAIL | 依修正清單改草稿 → 回 4.5.1 重跑（第 n+1 輪）；輪次上限見規則檔「詰問輪次上限」行，超限停止並升級人工，**不開卡、不寫留言** |
| 回傳無章面／章面殘缺 | 視為 FAIL，**重派同輪**（不加輪次）；**嚴禁自行補寫章面或自算 sha256——自書章行＝偽造** |

---

### Phase 5: 寫入 tracker（建立子任務 + 寫入留言）

> 前置：Phase 4.5 已取得 PASS 章。留言本體必須**逐字等於**該輪 `challenge-draft` 圍欄內容，唯一允許的差異是追加引章宣稱行——任何潤飾（改措辭、增刪段落、刪注記）都會使內容綁定失效、驗章必炸。

#### 5.1 準備參數

- `TRACKER.getParentMetadata(id)` 取 `assignedTo` / `iterationPath`
- `TRACKER.getParentImages(id)` 取父 WI 圖片，依各任務 `### 參考圖片` 標記附加到對應子任務 `description`

規則：

- 僅附加該任務標記的圖片
- 無對應 → `description` 不含圖片區段
- 嵌入格式由 `getParentImages` 的 `html` 欄位決定

#### 5.2 建立子任務

`createChildTask` 範本：

```
TRACKER.createChildTask({
  parentId: <ID>,
  title: "[T-XXX] <名稱>",
  assignedTo / iterationPath: <繼承父>,
  description: "<描述 + 依賴 + 包含檔案 + TDD R/G/R 流程> + <若有對應圖片 → getParentImages html>",
  acceptanceCriteria: "<AC + 驗證指令>"
})
```

#### 5.3 推導依賴邊並展示確認

把「任務摘要」表的「依賴」欄轉成待寫入的 tracker 原生依賴連結，供 `spex-implement`（Phase 2）與 `spex-schedule`（對帳）讀取：

1. 推導邊清單：每筆「T-YYY 依賴 T-XXX」→ `predecessor = <T-XXX 的 childId>` → `successor = <T-YYY 的 childId>`
2. **一次展示全部邊**等確認（依寫入前確認規則例外，單次確認即可，不逐邊確認）：

```
🔗 即將寫入依賴連結（predecessor → successor）：
- #<childId-1>（T-001）→ #<childId-2>（T-002）
- #<childId-1>（T-001）→ #<childId-3>（T-003）
```

#### 5.4 寫入依賴連結（開卡完成後必做）

所有 `childId` 回填、且 5.3 的依賴邊已取得確認後：

1. 收到「確認」→ 逐邊呼叫 `TRACKER.linkDependency(<predecessorId>, <successorId>)`（冪等，已存在視為成功）
2. 任一邊失敗 → 列出失敗清單與 `reason`，提示可重跑本步驟補寫；留言的「依賴」欄此時仍是 fallback 事實來源

#### 5.5 寫入 Task 留言（驗章通過才可寫）

1. 留言內容 = Phase 4.5 圍欄本體**逐字** + 末尾追加一行引章宣稱：

   ```
   challenge：PASS（第 <n> 輪｜章 <章號>）
   ```

2. 寫入前呼叫 `.claude/skills/spex-stamp/SKILL.md` 驗章。**exit ≠ 0 → 不得寫入**，依其回報的不變式編號處理（S5 內容綁定不符 = 本體被潤飾過，須以圍欄原文重發；S1 = 章號無效）。
3. 驗章 exit 0 → `TRACKER.addComment(<parentId>, <留言>)`。

#### 5.6 寫入子卡對照留言（獨立留言，不在章的範圍）

真實子卡 ID 與依賴邊寫入結果另寫一則 `## [Spex] Task 子卡對照` 留言：`T-XXX → #<childId>` 對照表、成功邊數、失敗清單。

**為何獨立**：真實 ID 只有開卡後才存在，若併入蓋章本體會使「章綁定的內容」與「最終寫入的內容」不一致、驗章必炸；而 ID 與依賴邊本來就能由 `TRACKER.getDependencies(parentId)` 從 tracker 直接重新推導，不需要章來擔保。

---

## Red Flags

- ❌ 任務有循環依賴
- ❌ 任務無法獨立驗證
- ❌ > 30% 任務缺 AC
- ❌ 水平分層（Types / Services / Components 各自一個 Task）
- ❌ 跳過 Phase 4.5 直接開卡 / 寫留言
- ❌ 自行補寫章面、自算 sha256，或以「內容看起來通過」宣告 PASS（＝偽造）
- ❌ 蓋章後潤飾留言本體（S5 內容綁定必炸，整輪作廢）
- ❌ 把真實子卡 ID 併進蓋章本體

## Verification

- [ ] 對話有完整技術計畫
- [ ] 任務按垂直切片組織
- [ ] 所有 AC 都有對應任務
- [ ] 依賴關係清晰無循環
- [ ] 每任務有 AC + 驗證方式
- [ ] TDD 流程已定義（R → G → R）
- [ ] Escalation 停損點已明確
- [ ] Phase 4.5 lint 全過、challenger 章面 `verdict=PASS`，章號已記錄
- [ ] Task 留言本體逐字＝圍欄內容，僅追加引章宣稱行
- [ ] 寫入前 `spex-stamp` 驗章 exit 0
- [ ] Phase 5.3 依賴邊已展示、確認後由 Phase 5.4 寫入 tracker 原生連結（失敗邊已列出）
- [ ] 子卡 ID 對照寫在獨立留言，未混入蓋章本體
