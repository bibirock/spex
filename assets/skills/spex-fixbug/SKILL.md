---
name: spex-fixbug
description: 缺陷路線 M / L 規模專用的根因追蹤 skill。以資深工程師角色深入分析 Bug 根因，調用 github MCP 查影響套件的議題與正確用法、調用 stackoverflow MCP 查相似錯誤討論，產出可驗證的根因假設與修復方向，供 plan 使用。前置：spex-plan Phase 2 分類為缺陷路線且規模 M / L。後續：重跑 spex-plan（續技術計畫）。
---

# Spex: Fixbug — 缺陷根因追蹤

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，**禁止整檔載入**。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 1 讀 tracker item（description = 規格來源） |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 8 寫留言 |

## Overview

資深工程師角色。**唯一職責：把模糊缺陷症狀拆到可驗證的根因假設，並為 plan 提供修復方向。** 不設計修復架構（plan 的事），不實作修復（implement 的事）。

## When to Use

- ✅ plan Phase 2 分類為缺陷路線 + 規模 M / L
- ✅ 症狀清楚但根因不明
- ✅ 涉及第三方套件非預期行為
- ✅ 需回推呼叫鏈才能定位
- ❌ S 規模 → 直接 `spex-plan`
- ❌ 需求路線 → 直接 `spex-plan`
- ❌ 根因已在規格中點出 → 直接 `spex-plan`
- ❌ 純 UI / 文案修正

---

## 核心規則

1. **證據優先**：每條假設必對應至少一條證據（重現步驟 / 程式碼 file:line / 套件原始碼或 changelog / GH issue / SO 連結）。無證據不寫。
2. **不取代 plan**：本 skill 只到「修復方向」為止；元件拆分 / 檔案清單 / 測試策略 / API 設計留給 plan。
3. **外部資源是輔助**：github / stackoverflow 用於佐證或反駁，不是貼解法。完全找不到也是訊號，必須記錄已搜尋的關鍵字。
4. **資料即症狀**：Phase 2 必須索取最小重現資料樣本；沒拿到不進 Phase 4。

---

## Process

### Phase 1: 取得規格與分類上下文

#### 1.1 來源判斷

| 情況 | 動作 |
|---|---|
| 對話已有 plan Phase 2 分類產出（規格 + 缺陷規模 M/L + 重現步驟 + 修復完成定義 + tracker ID） | 跳 1.2 |
| 無分類資訊 | 先自動取 ID：執行 `git branch --show-current`，依 SDD workflow 規則的「Branch Naming」格式解析 tracker item ID（符合自動化流程，不需詢問）；不符才向使用者詢問 ID。取得後 → `TRACKER.readItem(id)` 自 description 取規格（spec-template 格式）、`reproSteps` 與修復完成定義；缺陷規模依 plan 的 S/M/L 標準判定並請使用者確認 |
| description 無規格或無重現步驟 | 停止 → 「請先以 `spex-write-spec` 補規格，再跑 `spex-plan` 分類」 |
| 規模 S | 停止 → 「請改用 `spex-plan`」 |
| 需求路線 | 停止 → 「請改用 `spex-plan`」 |

#### 1.2 載入 SDD 規則

依 adapters/README.md 的 grep+offset SOP 主動讀取所需章節（章節 grep 不到 → fallback 整檔讀），不依賴編輯器自動載入：

- `.claude/rules/sdd-workflow.md` — 「核心原則」「Branch Naming」「分支生命週期」「架構與路徑映射」「File Zones」「程式碼導航策略」章節

探索結果寫入 memory（`type: project`）供下次取用；與當前規則檔不符時以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-fixbug` 的 `active` 教訓，把其「防護」納入本輪根因分析注意點；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

#### 1.3 前置檢核

**分支驗證（強制最先）：** 執行 `git branch --show-current`，必須符合 SDD workflow 規則的「Branch Naming」定義的命名格式與驗證 regex。不符 → 停止，依 SDD workflow 規則的「分支生命週期」處理。

- [ ] 分支符合命名規則
- [ ] 缺陷路線 M / L
- [ ] 重現步驟存在
- [ ] 修復完成定義存在
- [ ] tracker ID 明確

---

### Phase 2: 症狀分析與重現驗證

#### 2.1 症狀拆解

| 項目 | 內容 |
|---|---|
| 觸發條件 | 前置狀態 / 輸入 |
| 觀察錯誤 | 完整訊息 + stack trace |
| 預期行為 | 正確時應發生什麼 |
| 影響範圍 | 已知受影響的使用者 / 路徑 |
| 不影響範圍 | 哪些情境**不會**重現（與會重現同等重要） |

#### 2.2 重現穩定性

| 等級 | 定義 |
|---|---|
| **必現** | 步驟 100% 觸發 |
| **高頻** | 多次嘗試大多觸發 |
| **偶發** | 難穩定觸發 |

偶發 → Phase 6 必含「穩定重現策略」。

#### 2.3 輸入資料蒐集（強制）

依 Bug 性質向使用者索取（逐項，不批量問）：

```
為精準定位根因，請提供（有的提供即可）：

1. 最小輸入樣本 — YAML / JSON / API payload / 輸入字串 / URL params
2. 資料狀態快照 — 前端狀態容器 / 本地儲存 / 快取 / DB 關鍵欄位（可匿名化）
3. 相鄰操作序列 — 觸發前的操作順序
4. 不會觸發的對照樣本

資料量大或敏感 → 提供匿名化最小重現樣本。
```

取得後：

1. **本地驗證重現**
2. **資料結構掃描**：重複 key / 欄位缺失 / 型別不符 / 編碼異常 / 規模超限 / 跨欄位約束違反
3. **資料瑕疵紀錄** → Phase 7「資料層觀察」 + Phase 5 優先假設候選

無法提供 → Phase 7 標「無真實資料樣本」；Phase 4 相關性降低；Phase 6 修復方向加「取得資料後二次確認」。

---

### Phase 3: 影響面盤點

> **程式碼導航**依 SDD workflow 規則的「程式碼導航策略（LSP 優先）」— 找定義 / 引用 / 型別優先用 LSP；LSP 不可用時依該節安裝指引提示使用者，再 fallback 至 grep / glob，並在 Phase 7 報告中標註。

#### 內部影響面（依 SDD workflow 規則的「架構與路徑映射」）

| 層 | 受影響項目 | 位置 |
|---|---|---|
| 使用者可見入口 | ... | file:line |
| 邏輯複用 | ... | file:line |
| 狀態管理 | ... | file:line |
| API / 資料邊界 | ... | file:line |
| 型別 / 契約 | ... | file:line |
| 工具函式 | ... | file:line |

> 路徑不寫死，依 SDD workflow 規則的「架構與路徑映射」填。

#### 外部依賴影響面

| 套件 | 版本 | 角色 | 列於「架構與路徑映射」 |
|---|---|---|---|
| ... | ... | ... | 是 / 否 |

此清單為 Phase 4 調查目標。

---

### Phase 4: 外部調查 

對 Phase 3 每個重點套件（核心優先）。

#### 4.1 github MCP

```
mcp__github__search_issues          query: "<錯誤訊息> repo:<owner>/<pkg>"
mcp__github__search_pull_requests   query: "<API> repo:<owner>/<pkg> is:merged"
mcp__github__search_code / get_file_contents   # 確認正確用法
```

記錄：已關閉 issue 的 fix commit / 開啟 issue 的 workaround / 完全找不到 → 「無公開討論」。

#### 4.2 stackoverflow MCP

```
mcp__stackoverflow__so_search    query: "<錯誤訊息> <套件>"
mcp__stackoverflow__get_content  url: <題目>
```

擷取 accepted answer / 高票回答 / 相關 issue 連結。

| 結果 | 解讀 |
|---|---|
| 多個高票指向同一根因 | 高可信度 → 主假設 |
| 回答互相矛盾 | 列為「需驗證的多種可能」 |
| 完全找不到 | 「無社群討論」 |

#### 4.3 證據彙整

```
證據-NN: <一句話結論>
  來源: <連結 / commit hash>
  關聯: Phase 2 症狀 NN / Phase 3 影響面 NN
```

至少 1 條證據才能進 Phase 5；全部「無相關討論」必須明列已搜尋關鍵字。

---

### Phase 5: 根因假設

#### 5.1 建立假設（1–3 條）

```
假設-N: <一句話>
  支持證據: 編號
  反駁證據: 若有
  可驗證方法: 程式碼觀察 / 加 log / 小測試 / 切換版本
  優先級: 高 / 中 / 低
```

#### 5.2 主假設選定

| 條件 | 處理 |
|---|---|
| 某假設證據明顯壓倒 | 選為主假設，其他列備案 |
| 證據相當 | 列「需 spike 才能決定」，Phase 6 加驗證 spike |

---

### Phase 6: 修復方向（不寫實作）

```
方向-N: <一句話>
  涉及層 / 模組: Phase 3 列過的
  核心改動: <例：升級 X 套件 ≥ v3.2>
  預期效果: 對應修復完成定義第 N 項
  風險 / 取捨: 若有
```

- **禁寫：** 程式碼片段、檔案修改清單、測試案例設計
- **要寫：** 方向、層級、預期效果、風險

偶發 Bug → 必含「穩定重現策略」（固定亂數種子 / mock 時序 / 注入特定資料）。

---

### Phase 7: 資料層觀察

彙整 Phase 2.3 蒐集到的輸入資料樣本與結構掃描結果，作為 Phase 8 留言的「資料層觀察」段落來源：

- **資料瑕疵**：Phase 2.3 掃描到的重複 key / 欄位缺失 / 型別不符 / 編碼異常 / 規模超限 / 跨欄位約束違反，逐項列出並標註是否已列為 Phase 5 的優先假設候選
- **無真實資料樣本**：使用者無法提供輸入樣本時，本節標「無真實資料樣本」，並確認 Phase 4 相關性判斷已調降、Phase 6 修復方向已加註「取得資料後二次確認」
- **程式碼導航精度**：若 Phase 3 因 LSP 不可用而 fallback 至 grep / glob，於此註記精度可能下降

---

### Phase 8: 寫入 tracker 留言

```
## [Spex] Fixbug 完成

### 規模 / 症狀摘要 / 資料層觀察 / 影響面 / 外部調查 / 證據鏈 / 主假設 / 修復方向 / 給 Plan 階段的交付

### 下一步
重跑 `spex-plan`（Phase 2.7 載入本留言後續行技術計畫）
```

**✅ 展示完整留言，等「確認」後 `TRACKER.addComment(<ID>, "<留言>")`。** 調整 → 更新後重貼。

---

## Red Flags

- ❌ 假設無對應證據編號
- ❌ Phase 4 完全跳過
- ❌ Phase 4 呼叫但沒記錄結果
- ❌ 修復方向變成程式碼片段
- ❌ 偶發 Bug 沒穩定重現策略
- ❌ 主假設與「不會重現的情境」明顯衝突
- ❌ 沒寫入 tracker 留言
- ❌ S 規模或需求路線誤用本 skill
- ❌ Phase 2.3 跳過、沒索取資料樣本就進 Phase 4
- ❌ 拿到樣本沒做結構掃描就跳外部調查
- ❌ 使用者無法提供資料時沒在報告標示

## Verification

- [ ] Phase 1 完整規格與分類上下文且為 M / L 缺陷
- [ ] Phase 2.1 / 2.2 拆解與穩定性已標
- [ ] Phase 2.3 已索取樣本並做結構掃描（或明確標示無法取得）
- [ ] Phase 3 內外部影響面完整
- [ ] Phase 4 每重點套件 github + stackoverflow 搜尋並記錄
- [ ] Phase 5 主假設證據充足、可驗證方法明確
- [ ] Phase 6 只給方向、未越線
- [ ] Phase 6 偶發 Bug 含穩定重現策略
- [ ] Phase 7 根因報告完整（含資料層觀察）
- [ ] Phase 8 已展示留言、收到確認後寫入

## Next Steps

→ 重跑 `spex-plan`（Phase 2.7 偵測到本 fixbug 留言後，直接以主假設 + 修復方向為設計輸入續行）
