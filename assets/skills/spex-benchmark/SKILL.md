---
name: spex-benchmark
description: 基準與成本紀錄者。手動觸發、不入自動鏈：彙整每張卡的 SDD 基準數據（token 成本、$/Scrum 點對團隊自訂目標、可靠度、PR 管控、任務相依）與 4 大目標進度，量測時排除本 skill 自身 token（以觸發訊息 timestamp 為截點），資料源為 ccusage + session JSONL，結果經確認後以 TRACKER.recordBenchmark 寫入「會渲染表格與可勾 to-do」的 Notion 頁面內文。前置：無（使用者手動於某些卡片走完 SDD 後呼叫）。後續：人類依 to-do 檢核 4 大目標。
---

# Spex: Benchmark — 基準與成本紀錄

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.readItem`](../../reference/adapters/README.md#trackerreaditemid) | Phase 0 讀每張卡的 title / state（估點若 description 有則一併取） |
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 2 讀各卡 Verify / PullRequest / Task 留言，填可靠度 / PR 管控 / 相依欄 |
| [`TRACKER.recordBenchmark`](../../reference/adapters/README.md#trackerrecordbenchmarkparams) | Phase 3 把基準表格 + 4 目標 to-do 寫入 Notion 頁面內文（選用操作；未實作則 fallback 輸出 Markdown） |

## 規則載入與記憶快取

啟動時依 adapters/README.md 的 grep+offset SOP 主動讀取（章節 grep 不到 → fallback 整檔讀）：

- `.claude/rules/sdd-workflow.md` — 「Tracker Adapter」「ID 事實鐵則」章節
- `.claude/reference/adapters/<當前 adapter>.md` — 只讀 `TRACKER.recordBenchmark` 章節（取 `target` 形式與 append/replace 實作）

模型單價以 `claude-api` skill 為權威來源（input / output / cache-write / cache-read 各模型 per-MTok 價）；探索結果寫入 memory（`type: project`，檔名固定 `sdd-rules-cache.md`，同 key 更新不新增）。

## Overview

基準與成本紀錄者。**唯一職責：把已完成的 SDD 工作量測成可檢核的基準數據與 4 大目標進度，寫進可渲染的 Notion 頁面，供人類核對團隊自訂的成本目標。本 skill 不實作功能、不改程式碼、不開 PR。**

設計原則：

1. **手動、不入自動鏈**——只由使用者手動呼叫，不被 plan/implement/schedule 自動觸發（避免無謂 token 消耗）。
2. **排除自身 token**——量測 SDD 成本時以「觸發本 skill 的指令訊息 timestamp」為截點，只計截點前的用量；本 skill 自己的回合不算進 SDD 成本。
3. **數字必有來源**——token 用量取自 `ccusage` / session JSONL，估點取自卡片（讀不到請使用者提供，**不臆造**）；無來源的格子填 `N/A` 並標註。
4. **可渲染才算數**——表格與 `- [ ]` to-do 必須寫進會渲染的載體（Notion 頁面內文 body，非留言），使用者才能真的勾選檢核。

## When to Use

- ✅ 使用者已對一張或多張卡走完 SDD（或一個 schedule 批次），想記錄 token 成本與 4 大目標達成度
- ✅ 想驗證「每 Scrum 點成本是否在團隊設定的目標內」
- ❌ 想自動在每張卡記成本 → 不支援（各階段 skill 已移除成本欄，成本只在本 skill 手動彙整）
- ❌ 想開 PR / 改程式碼 → 不在本 skill 範圍

## 前置工具檢查

- `ccusage` 是否可用：`command -v ccusage`（本機已裝；缺則提示 `npx ccusage` 或 `npm i -g ccusage`）。
- session JSONL 目錄：`~/.claude/projects/<專案編碼>/<session>.jsonl`（每則 assistant 訊息含 `message.model` 與 `message.usage`）。

---

## Process

### Phase 0: 輸入盤點

1. 取得本次要紀錄的卡片 `Item ID`（可多張；ID 須能由 tracker 讀回，遵「ID 事實鐵則」）。
2. 取得**目標基準頁**：Notion 頁 URL / UUID（`TRACKER.recordBenchmark` 的 `target`）。使用者未給 → 請其提供，或約定 `append` 建子頁的母頁。
3. 取得 **USD→TWD 匯率**（預設請使用者確認一個值；不臆造即期匯率）。
4. 對每張卡 `TRACKER.readItem(id)` 讀回 `title` / `state`；估點取自卡片 description / 估點欄，讀不到 → 請使用者提供（**$/點的分母，缺則該卡 $/點填 N/A**）。

### Phase 1: 成本量測（排除自身）

> 目標：得出本次 SDD 工作（截點前）的 token 用量與 USD 成本，**排除呼叫本 skill 後的回合**。

1. **定位 session JSONL**：`ls -t ~/.claude/projects/*/*.jsonl | head -1`（最新寫入者即當前 session）；多專案疑慮時列出候選請使用者確認。
2. **決定截點**：截點 = 本次「觸發 benchmark 的使用者指令訊息」之 `timestamp`（JSONL 內含 `/spex-benchmark` 或等義指令那一則 user 訊息）。
3. **加總截點前用量並計價（主要、精確）**：對 JSONL 中 `type=="assistant"` 且 `timestamp < 截點` 的訊息，逐則取 `message.model` 與 `message.usage`（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`），各 token 類別 × 該 model 對應公開單價（`claude-api` skill）→ 加總得 **USD**。
   - 參考加總（未計價，先看量級）：
     ```bash
     JSONL=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
     jq -s '[ .[] | select(.type=="assistant") | .message.usage
       | (.input_tokens//0)+(.output_tokens//0)+(.cache_creation_input_tokens//0)+(.cache_read_input_tokens//0) ] | add' "$JSONL"
     ```
4. **交叉驗證（ccusage）**：`ccusage session --json` 取當前 session 的 USD 與 token 分解（ccusage 依各 model 公開單價計價、含 cache token）。ccusage 是「整 session 含本 skill 尾段」，與第 3 步「截點前」之差額即本 skill 自身開銷——列出兩數供核對，最終 SDD 成本以**截點前數字**為準。
5. **多卡歸屬**：建議「一卡一量測窗」（單卡走完即跑一次 benchmark）。多卡同窗時用「自上次基準快照以來的增量」：上一筆基準紀錄存累計截點，本次只計新增量，避免重複計同一批 token。
6. **換算**：`USD × 匯率 = TWD`；每張卡 `TWD ÷ 估點 = $/點`，對**團隊自訂目標值**判 PASS（≤）/ 超標（>）。多卡時 $/點可用「該卡分攤的 TWD ÷ 該卡估點」或整窗「總 TWD ÷ 總估點」，並於表下註明採用哪種。

### Phase 2: 組裝紀錄（表格 + 4 目標 to-do）

組 Notion-flavored Markdown，**兩部分**：

**(A) 每卡基準表**

```
## SDD 基準 — <DATE>

| 卡片 | 狀態 | 估點 | Token(in/out/cache) | 成本 USD | 成本 TWD | $/點 | 對目標值 | 可靠度 | PR 管控 | 相依 |
|---|---|---|---|---|---|---|---|---|---|---|
| #<ItemID> <title> | <state> | <pt> | <i>/<o>/<c> | <usd> | <twd> | <usd_per_pt> | ✅≤ / ⚠️> | <Verify PASS·重做 n 輪> | <互動/預授權·確認者有原文·AI 自動開 PR=0> | <相依任務數·是否自動依序完成> |
```

- 可靠度 / PR 管控 / 相依欄由 `TRACKER.findSpecComment(id, "Verify"/"PullRequest"/"Task")` 讀回對應留言摘要填入；無對應留言 → 填 `N/A`。
- 表下註明：匯率、量測窗（單卡 / 增量）、$/點 計法、截點時間。

**(B) 4 大目標檢核 to-do**（`- [ ]` 可勾）

```
### 4 大目標檢核（<DATE>）

- [ ] Goal1 PR 開立控管：本批 AI 自動觸發開立的 PR 數 = 0；各卡 PullRequest 留言模式為「互動確認 / 預授權」且有確認者輸入原文
- [ ] Goal2 SDD 可靠度：無「錯誤實作被判成功」；防錯檢核 A–D 全數通過（見 selfcheck）
- [ ] Goal3 任務相依編排：<N> 張具相依關係的卡在無人工干預下依序完成
- [ ] Goal4 Token 成本：每 Scrum 點 ≤ <團隊自訂目標值>（本批實測 <值> / 點）
```

### Phase 3: 寫入 Notion 內文（非留言）

1. **展示完整內容**（表格 + to-do）給使用者，依「寫入前確認規則」等「確認」/「ok」/「yes」。
2. 呼叫 `TRACKER.recordBenchmark({ target: <基準頁>, content: <上面 Markdown>, mode: 'append' })`。
   - Notion adapter：寫入**頁面內文 body**（表格渲染成表、`- [ ]` 渲染成可勾 to-do）；留言載體不可用。
   - 回 `success: false` → fallback：把同一份 Markdown 直接輸出給使用者手動貼到 Notion 頁面內文。
3. 顯示寫入後的頁面連結。

### Phase 4: 收尾

- 回報：本批 $/點 與團隊自訂目標的達標結論、各 Goal to-do 連結（提醒由人類勾選確認）。

---

## Red Flags

- ❌ 把本 skill 自身回合的 token 算進 SDD 成本（必須以截點排除）
- ❌ 用 `/cost` 當資料源（只反映當前 session、訂閱制常不顯金額、輸出無法程式化讀取）
- ❌ 估點 / token 臆造（讀不到一律請使用者提供或填 N/A）
- ❌ 把表格 / to-do 寫進 Notion 留言（不渲染、不可勾）——必須寫頁面內文 body
- ❌ 被 plan / implement / schedule 自動觸發（本 skill 僅手動）
- ❌ 在本 skill 內改程式碼 / 開 PR

## Verification

- [ ] session JSONL 已定位；截點 = 觸發本 skill 的指令訊息 timestamp
- [ ] 成本只計截點前用量；ccusage session 總額已作交叉驗證並標出與截點前的差額
- [ ] 每張卡估點有來源；$/點對團隊自訂目標判定正確；匯率與計法已註明
- [ ] 可靠度 / PR 管控 / 相依欄由對應 Spex 留言帶出（無則 N/A）
- [ ] 4 大目標 to-do 逐條對映衡量標準（含防錯檢核逐項勾稽）
- [ ] 內容已展示並經確認後，以 `TRACKER.recordBenchmark` 寫入會渲染的 Notion 頁面內文（或 fallback 輸出 Markdown）

## Next Steps

→ 人類於 Notion 勾選 4 大目標 to-do 完成檢核；未達標項目（如 $/點超出目標）建立 Tech Debt / 優化 Story 追蹤。
