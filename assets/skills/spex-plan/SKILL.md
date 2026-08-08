---
name: spex-plan
description: SDD 流程中 spec 之後的第一站。讀取 work item description 的規格（spec-template 格式）做分類（需求/缺陷路線、Tier、缺陷規模）與輸入完整性檢核、建立工作分支，再產生技術實施計畫回寫 tracker 留言。Tier 1 直接開單張 Task 子卡跳過 task；缺陷 M/L 先分流 spex-fixbug。前置：規格已寫入 work item description（建議用 spex-write-spec）。後續：spex-task（Tier 2）/ spex-implement（Tier 1）。
---

# Spex: Plan — 分類與技術實施計畫
**思考過程不輸出，僅輸出分類結果與技術計畫摘要**
**思考過程不輸出，僅輸出分類結果與技術計畫摘要**
**思考過程不輸出，僅輸出分類結果與技術計畫摘要**

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 1 讀 work item（description = 規格來源） |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 2.7 找 Fixbug 留言 |
| [`TRACKER.ensureBranch`](../../reference/adapters/README.md#trackerensurebranchparams) | Phase 2.6 建工作分支 |
| [`TRACKER.getParentMetadata`](../../reference/adapters/README.md#trackergetparentmetadataid) | Phase 2.8（僅 Tier 1）取繼承欄位 |
| [`TRACKER.createChildTask`](../../reference/adapters/README.md#trackercreatechildtaskparams) | Phase 2.8（僅 Tier 1）開單張 Task 子卡 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 8 寫 Plan 留言 |

## 規則載入與記憶快取

啟動時依 adapters/README.md 的 grep+offset SOP 主動讀取所需章節（章節 grep 不到 → fallback 整檔讀），不依賴編輯器自動載入：

- `.claude/rules/sdd-workflow.md` — 「核心原則」「Tracker Adapter」「Branch Naming」「Branch Policy」「分支生命週期」「Plan 分析順序」「架構與路徑映射」「File Zones」「程式碼導航策略」章節；批次驅動時另讀「spex-schedule 批次模式互動確認規則」「多 Repo 執行紀律」「ID 事實鐵則」章節
- `.claude/rules/commands.md` — 整檔（驗證指令束）
- `.claude/rules/testing.md` — 「測試框架」「E2E / UI 驗證工具」章節

探索結果寫入 memory（`type: project`，檔名固定 `sdd-rules-cache.md`，同 key 更新不新增），至少涵蓋：Tier 升級條件命中情況、分支命名規則、架構與路徑映射重點；下次直接取用。memory 摘要與當前規則檔不符時，以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-plan` 的 `active` 教訓，把其「防護」納入本輪分類 / 技術計畫注意點；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

資深工程師角色，兩段職責：

1. **分類與檢核（Phase 1–2）**：把 description 內的規格分類（路線 / Tier / 缺陷規模）、檢核輸入完整性、釐清疑點、建立工作分支——這是規格進入 SDD 的入口。
2. **技術計畫（Phase 3–8）**：技術選型、架構、資料流、量化驗收、風險（關注 HOW）。

## When to Use

- ✅ 規格已寫入 work item description，要進入 SDD 流程
- ✅ Tier 2 變更、API 設計或架構決策
- ❌ 規格還沒寫 / 嚴重缺漏 → `spex-write-spec`
- ❌ 任務已拆解完成 → `spex-implement`

---

## Process

### Phase 1: 取得規格上下文

#### 1.1 來源判斷

| 情況 | 動作 |
|---|---|
| 使用者提供 tracker item ID | `TRACKER.readItem(id)` |
| 未提供 | 先自動取 ID：`git branch --show-current` 依 SDD workflow 規則「Branch Naming」解析；不符才詢問 |

讀取後：

- **規格來源 = description**（spec-template 格式）；另讀 `acceptanceCriteria` 欄位、缺陷加讀 `reproSteps`
- 附件處理（強制）：description 含 `<img>` → 依 adapter 附件指引讀圖；含 `figma.com` URL → 用 Figma MCP；工具不可用 → 請使用者手動描述
- adapter 連線失敗或 description 為空 → 請使用者手動貼上規格，**不可跳過**

#### 1.2 前置檢核

執行 `git branch --show-current`：

- 分支符合 SDD workflow 規則「Branch Naming」→ 記錄，Phase 2.6 將 no-op
- **批次模式**（由 spex-schedule 呼叫、已在共用分支 `chore/schedule-<YYYYMMDD-HHmm>`，符合「Branch Naming › 排程批次共用分支」）→ 記錄為合法分支，Phase 2.6 將 no-op（**不**建逐卡分支）
- 在 base 分支（dev / develop / development）或不符格式 → 正常情況（本 skill 是建立分支的人），留待 Phase 2.6 建立；**不可**在確認分類前自行 checkout

### Phase 2: 分類與輸入檢核（一次性判斷，等使用者確認）

整合輸出 A–E，等使用者一次確認，精簡用詞

#### 2.1 A. 路線分流

依 `TRACKER.readItem(id).type` 與 adapter「路線對應」表分流：`需求路線` / `缺陷路線`（不可在本 skill 寫死系統 type 名）。

#### 2.2 B. Tier 判斷

**自動升 Tier 2**（任一成立 → 完整 `plan → task → implement → selfcheck → pull-request`）：

- 提及 API / endpoint / schema / migration
- 多元件 / 跨層改動（store + component + server/api）
- 效能 / security / auth / role / policy / payment
- 外部整合（Azure DevOps API、GCP、第三方 SDK）
- 新依賴

**否則為 Tier 1**（單檔 / 單元件、無 API 變動、無新依賴 → 由本 skill 直接開單張 Task 子卡，跳過 task → `implement → selfcheck → pull-request`）。

| 維度 | Tier 1 | Tier 2 |
|---|---|---|
| 檔案數 | ≤ 1（不含測試） | ≥ 2 |
| 層數 | 單層 | 多層 |
| `server/api/` 變動 | 無 | 有 |
| 外部整合 | 無 | 有 |
| 估時 | < 1 小時 | ≥ 1 小時 |

**預設安全**：模糊時取 Tier 2；執行中發現複雜度不符 → 立即升級，不可降級（降 Tier 需使用者明示確認）。

#### 2.3 C. 缺陷規模（僅缺陷路線）

| 規模 | 條件 |
|---|---|
| **S** | 單一元件 / 檔案，無跨層 |
| **M** | 單一路徑跨 2–3 層 |
| **L** | 跨模組 / 跨層且有相依風險 |

#### 2.4 D. 輸入規格檢核

`Read` `.claude/reference/spex/spec-template.md`，依其「品質檢核清單」逐項比對 description：

- 列出缺漏章節與不合格項（如 AC 含模糊詞、列舉完整性清單缺漏）
- 缺漏輕微 → 轉為 2.5 的疑點提問補齊
- **缺漏嚴重**（必填章節缺 3 項以上，或 AC 整體不可二元判定）→ 建議使用者先跑 `spex-write-spec` 補規格，本 skill 暫停

### Phase 2.4 E: 現有程式碼結構分析

> **程式碼導航**依 SDD workflow 規則的「程式碼導航策略（LSP 優先）」；LSP 不可用時依該節安裝指引提示使用者，再 fallback 至 grep / glob，並在輸出摘要中標註。

1. **檔案掃描順序**依 SDD workflow 規則的「Plan 分析順序」（使用者可見入口 → 邏輯複用 → 狀態管理 → API/資料邊界 → 型別/契約 → 工具函式 → 測試 → 規格文件）；skills 不可自行預設框架工作流。
2. **相容性分析**：影響哪些既有模組？違反架構邊界？循環依賴？破壞 API 合約？
3. **複用機會**：可複用 composable / utility / UI 元件 / 測試 fixture / 型別。

#### 2.5 E. 疑點提問與假設

- 問題品質三條件與 Ask vs Assume 定義見 `spex-write-spec`（相關性 / 可回答性 / 未覆蓋；會改變規格的問、合理推斷列假設）
- **疑點不限數量、不設最小**：有幾個真實疑點問幾題；規格夠清楚時零題正常
- 假設篩選（三全 Yes 才列）：規格沒明說 / 若錯會改變規格或 AC / 從本 item 衍生的具體疑點
- ❌ 禁止：為湊題數問泛用題、問 description / Figma 已明說的事

#### 整合輸出格式

```
- 路線: <需求 / 缺陷>
- Tier: <1 / 2>
- 缺陷規模: <S / M / L>（缺陷才填）
- 理由: <一句話>
- 分支建議: <type>/<TRACKER_PREFIX>-<id>-<kebab-case-summary>（前綴依當前 adapter；需求 → feature；缺陷 → fix；其他由使用者明示）
- 輸入檢核: <通過 / 缺漏清單>

關鍵發現：
✓ 可複用：[x項]
⚠️ 需新增：[層級 / 元件]
⚠️ 影響面：[受影響的模組]
⚠️ 風險：[相容性 / 依賴 / API 合約]

完整檔案清單見 Phase 7。

## 疑點（若有，數量不限）
1. ...

## 假設（若無，寫「無重大假設」）
1. ...

⚠️ 請一次確認。全對回「確認」；錯誤直接指出。
```

**必須等使用者確認後才進 2.6。**

#### 2.6 建立工作分支（確認後立即執行，不需二次確認）

> **批次模式例外**：由 spex-schedule 呼叫且已在共用分支 `chore/schedule-<YYYYMMDD-HHmm>`（Phase 1.2 已記錄）→ 本步驟 **no-op**，不呼叫 `ensureBranch`、不建逐卡分支（整批共用同一分支，見 SDD workflow 規則「分支生命週期 › 排程批次例外」）。

```
TRACKER.ensureBranch({ id: <id>, type: <feature / fix / refactor / chore>, summary: <kebab-case-summary> })
```

| 回傳 | 行動 |
|---|---|
| `success: true, created: true` | 「✅ 已建立分支 `<branchName>`（從 `<baseBranch>`）」 |
| `success: true, created: false` | 「✅ 已在分支 `<branchName>`」 |
| `success: false` | 顯示 `reason`，依「分支生命週期」停止 |

#### 2.7 缺陷 M / L 強制分流

| 路線 / 規模 | 動作 |
|---|---|
| 需求、或缺陷 S | 進 2.8（Tier 1）或 Phase 3（Tier 2） |
| 缺陷 **M / L** | `TRACKER.findSpecComment(id, "Fixbug")`：**找到** → 擷取「主假設 / 修復方向 / 給 Plan 階段的交付 / 影響面」作設計輸入，明說「✅ 已載入 fixbug 留言」，續 Phase 3；**找不到** → 停止：「請先執行 `spex-fixbug`，完成後重跑本 skill。」**不可繞道、不可自做根因分析** |

#### 2.8 Tier 1：直接開單張 Task 子卡（僅 Tier 1，跳過 Phase 3–8）

Tier 1 不需技術計畫與任務拆解；為讓 implement 可接續、tracker 留存紀錄：

1. `TRACKER.getParentMetadata(id)` 取繼承欄位
2. 經寫入前確認後 `TRACKER.createChildTask(...)` 開**一張** Task 子卡（`workItemType` 與同層既有子卡一致）：標題 `[T-001] <一句話描述>`、對應 AC（引用規格驗收標準）、TDD R/G/R 骨架、變動檔案（依「架構與路徑映射」推導）
3. 於父卡寫 Task 上下文留言（與子卡同批確認）：

```
## [Spex] Task 完成 [tier-1]

### 任務摘要
<一句話>

### TDD 流程
T-001：Red → Green → Refactor

### 子任務狀態
- T-001 → <childId>
```

4. 提示：「Tier 1 已開立 Task #<childId>，可直接執行 `/spex-implement`。」**結束本 skill。**

---


### Phase 3: 政策確認

**依賴政策：**

- 預設僅使用 SDD workflow 規則的「架構與路徑映射」列出的依賴
- 必須引入規範外依賴 → 在 Phase 7「技術風險」列出（名稱 + 版本 + 用途 + 替代方案評估 + 標「待 review」）
- 不可偷偷加上後當既成事實

**缺陷 M / L 額外納入 fixbug 報告作為設計起點，不得忽略或重新質疑根因假設**（要重新質疑請回 fixbug）：主假設 → 設計目標；修復方向 → Phase 3 / 4 / 7 起點；外部依賴 → 依賴政策輸入；內部影響面 → Phase 4 優先檢查目標。

---

### Phase 5: MVP 邊界檢查

確認每個技術決策只服務於 In Scope：

- 是否超出 MVP 邊界？
- 是否有「以後可能會用到」的預設計？

超出 → 標：`❌ <設計項目> 超出 Story 範圍，本次不實作。`

---

### Phase 6: 量化驗收（需求重新框架）

> 各層框架名稱以 testing 規則 Layers 表為準。

**驗證方式優先序（強制思考順序）：**

1. ✅ 單元測試框架 — 邏輯 / 資料轉換 / 純函式
2. ✅ 元件測試框架 — UI 互動 / 流程序列
3. ✅ E2E 測試（testing 規則指定工具） — 真實流程驗證
4. ✅ Lighthouse / Performance API — 效能驗證
5. ✅ 手動驗證 — 無法自動化的驗收條件

**每條需求先問「能不能用單元測試框架寫？」不能才往下。**

**強制：** 每條量化條件必書面寫出「為何選 / 不選單元測試框架」。Verification 會逐條檢查，空白視為未完成。

| 模糊需求 | 量化 | 主要驗證 | 為何選 / 不選單元測試 | 補充 |
|---|---|---|---|---|
| YAML 轉換正確 | 節點樹輸出與預期 YAML 完全一致 | 單元測試 | 純函式 → 選 | — |
| 流程要簡潔 | ≤ 3 步驟、state ≤ 3 個 | 元件測試 | state 轉換可測 → 選；視覺體感不可測 → 補手動 | 手動驗證 |
| UI 要快 | LCP < 2.5s @ 4G | Lighthouse | 渲染時間需真實瀏覽器 → 不選單元 | Performance API |

---

### Phase 7: 技術計畫摘要，不輸出

寫入 tracker 留言：

```
# 技術實施計畫 — <功能>

> Tracker Item: <ID> | 階段: Plan | Tier: <1/2> | 日期: <DATE>

## 技術棧
| 類型 | 選擇 | 理由 | 備註 |

## 成功條件（量化）
| 需求 | 目標 | 主要驗證 | 為何選 / 不選單元測試 | 補充 |

## 架構設計
### 元件 / 模組拆分
### 資料流
### API 設計（若有）

## 預計新增 / 修改檔案
> 路徑依 SDD workflow 規則的「架構與路徑映射」與「File Zones」，不寫死。

## 測試策略
| 層次 | 工具 | 範圍 | 覆蓋率 |
| Unit | testing 規則 單元測試框架 | Store / Utils / Composables | ≥ 80% |
| Component | testing 規則 元件測試框架 | 元件 | ≥ 70% |
| E2E | 若需要 | 主流程 | 關鍵路徑 |

## 技術風險與緩解
| 風險 | 機率 | 影響 | 緩解 |

> 規範外依賴在此列：名稱 + 用途 + 替代方案評估 + 「待 review」

## Future Considerations
- 刻意排除的項目
```

---

### Phase 8: 寫入 tracker 留言

```
## [Spex] Plan 完成 [tier-<n>]

### 分類結果
- 路線 / Tier / 缺陷規模（缺陷才填）/ 輸入檢核結果

### 設計輸入來源（缺陷 M / L 才填）
- 依據 fixbug 留言：主假設 / 採用修復方向

### 技術棧 / 成功條件（量化） / 架構設計 / 預計修改檔案 / 驗收標準（來自規格） / 技術風險 / 規範外依賴 / 資料流分析

### 下一步
`spex-task`
```

**✅ 展示完整留言，等「確認」後 `TRACKER.addComment(<ID>, "<留言>")`**（內容同 Phase 7 已展示且無變更時，得引用展示不重貼，見寫入前確認規則例外）。

---

## Red Flags

- ❌ 分類（路線 / Tier / 規模）未經使用者確認就繼續
- ❌ 輸入檢核缺漏嚴重卻硬做計畫（應導向 `spex-write-spec`）
- ❌ 為湊題數問泛用疑點；或有會改變規格的疑點卻不問
- ❌ 確認前自行 checkout / 建分支
- ❌ 缺陷 M / L 沒先載入 fixbug 留言；或找不到卻自做根因分析（越權）
- ❌ Tier 1 卻走完整 Phase 3–8（過度設計）；Tier 2 卻直開子卡（漏設計）
- ❌ 成功條件無量化（「快」「好」「穩」）；「為何選 / 不選單元測試」欄位空白
- ❌ 設計超出「架構與路徑映射」但未列「技術風險」
- ❌ 計畫完成才發現架構無法支援某 AC
- ❌ Phase 8 沒展示完整留言就寫入

## Verification

- [ ] Phase 1 已取得 description 規格（含附件 / Figma）
- [ ] Phase 2 分類 + 輸入檢核 + 疑點/假設已一次展示並經使用者確認
- [ ] 疑點數量與真實疑點一致（可為零；不限上限）
- [ ] Phase 2.6 `ensureBranch` 回傳 `success: true`
- [ ] 缺陷 M / L：fixbug 留言已載入；找不到時已停止
- [ ] Tier 1：已開單張 Task 子卡並寫 Task 上下文留言後結束
- [ ] Tier 2：Phase 3–8 完成；技術棧已決定；規範外依賴已記入風險
- [ ] Phase 6 每條成功條件已量化；「為何選 / 不選單元測試」無一空白

## Next Steps

- Tier 2 → `spex-task`
- Tier 1 → `spex-implement`（子卡已開）
- 缺陷 M / L 無 fixbug 留言 → `spex-fixbug` → 重跑本 skill
