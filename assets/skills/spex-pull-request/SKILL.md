---
name: spex-pull-request
description: PR 開立唯一入口。前置 Gate 強制 selfcheck Verify PASS，組裝 PR 內容後依「互動確認 / 全自動預授權」雙路徑開立 Pull Request，寫入稽核留言並完成任務鏈閉環。整個 SDD 流程中只有本 skill 允許呼叫 TRACKER.createPullRequest。前置：spex-selfcheck（PASS）。後續：人類 reviewer。
---

# Spex: Pull Request — PR 開立

## Adapter 引用

讀取 adapter 文件時依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀對應章節，禁止整檔載入。

| 操作 | 用途 |
|---|---|
| [`TRACKER.findSpecComment`](../../reference/adapters/README.md#trackerfindspeccommentid-phase) | Phase 1 取 Verify / Task 留言 |
| [`TRACKER.getDependencies`](../../reference/adapters/README.md#trackergetdependenciesparentid) | Phase 1 取子任務清單確認全數 done |
| [`TRACKER.createPullRequest`](../../reference/adapters/README.md#trackercreatepullrequestparams) | Phase 4 開 PR（**全流程唯一呼叫點**） |
| [`TRACKER.updatePullRequest`](../../reference/adapters/README.md#trackerupdatepullrequestparams) | Phase 5 PR 已存在時更新 |
| [`TRACKER.addComment`](../../reference/adapters/README.md#trackeraddcommentid-content) | Phase 4 寫稽核留言 |

## 規則載入與記憶快取

啟動時依 adapters/README.md 的 grep+offset SOP 主動讀取（章節 grep 不到 → fallback 整檔讀）：

- `.claude/rules/sdd-workflow.md` — 「Branch Naming」「Branch Policy」「PR 開立控管」「Definition of Done」章節
- `.claude/rules/testing.md` — 「E2E HTML 報告」章節（暫留報告的清理路徑）

探索結果寫入 memory（`type: project`）；與當前規則檔不符時以規則檔為準並更新 memory。

**教訓取回（Recall）**：啟動時另 grep `.claude/lessons/INDEX.md`（不存在則略過），取 `skills:` 含 `spex-pull-request` 的 `active` 教訓，把其「防護」納入本輪 PR 開立注意點（Verify Gate / 分支推送 / PR 組裝）；引用的檔／旗標已不存在 → 標 `status: retired`（Prune）。依 `.claude/rules/sdd-workflow.md`「教訓回收與升級」。

## Overview

PR 開立守門員。**整個 SDD 流程中，`TRACKER.createPullRequest` 只允許在本 skill 的 Phase 4 呼叫**——implement / schedule / 其他任何流程一律不得直接開 PR（流程化隔離，對應「禁止 AI 自動開 PR」要求；防範 config 誤觸發自動開 PR 的已知風險）。

人為介入點雙路徑：

- **互動確認（預設）**：展示完整 PR 內容，等使用者明確輸入「確認」才開立。
- **全自動預授權**：使用者已輸入明確授權語句 → 展示內容後直接開立，稽核留言記錄授權原文與時間戳。兩種有效語句：
  - 「**授權本次全自動開立 PR**」（單一任務鏈，使用者於對話中直接給）——僅該次任務鏈有效
  - 「**授權本批次全自動開立 PR**」（批次，由 schedule Phase 2 收集）——涵蓋該排程批次內各卡片，每卡稽核留言引用同一原文與時間戳，批次結束即失效

  授權不跨對話、不持久化。

### 兩種開立模式

- **單卡模式（預設）**：單一任務鏈呼叫，source = 該卡 `<type>/ADO-<id>-...` 分支，PR 涵蓋一張父卡（+子任務）。
- **批次最終模式（`mode: batch-final`，由 spex-schedule Phase 4.B 呼叫）**：source = 共用分支 `chore/schedule-<YYYYMMDD-HHmm>`（見 SDD workflow 規則「Branch Naming › 排程批次共用分支」），**一個** PR 涵蓋整批所有 done 卡片。卡片 ID 清單由 schedule 傳入（**不**從分支名解析）；Phase 1 Verify Gate 對清單**逐卡**檢查、Phase 2 `workItemIds` 聚合全批、Phase 4 稽核留言寫入**每張**父卡。

Claude Code 環境另有技術層防護：spex 安裝時把開 PR 工具寫入 `.claude/settings.json` 的 `permissions.ask`（互動 session 由使用者當下核准、headless 自動拒絕）。

## Process

### Phase 1: 前置 Gate（任一不過即停止）

1. **分支驗證（強制最先）**：`git branch --show-current` 須符合 SDD workflow 規則「Branch Naming」。
   - 單卡模式：自分支名解析 tracker item ID。
   - **批次最終模式**：分支須符合「排程批次共用分支」regex（`^chore/schedule-\d{8}-\d{4}$`）；卡片 ID 清單由 schedule 傳入，**不**從分支名解析。
2. **Verify Gate（不可繞道）**：對每個待開卡片 ID `TRACKER.findSpecComment(id, "Verify")` 取最新一筆（批次模式 → **逐卡**檢查清單內每張卡）：
   - 不存在或標題為 `Verify Fail` → **停止**：「請先執行 `spex-selfcheck` 並取得 PASS。」（批次模式：列出未 PASS 的卡片，整批停止，不開部分 PR）不得以任何理由跳過。
   - `Verify 完成`（PASS）→ 擷取其「AC 對照表」供 Phase 2 使用；若 PASS 之後分支又有新 commit → 停止，要求重跑 selfcheck。
3. **章戳 Gate（不可繞道）**：對每個待開卡片呼叫 `.claude/skills/spex-stamp/SKILL.md` 對事件流做最終稽核（Task／Implement 的 challenge 章與 Verify 留言的 `驗收章`）。**exit ≠ 0 → 停止、不得開 PR**（批次模式：列出未過的卡片，整批停止）。無事件流的環境（Codex / Copilot）→ 於稽核留言標注「本環境無章可驗」，不得宣稱驗章通過。
4. **任務狀態**：每張待開卡片以 `TRACKER.getDependencies(<parentId>)` 取子任務清單，全數 `done`（Tier 1 為單張 Task）。
5. **分支已推送**：本地與遠端同步；未推送 → 明確告知使用者後執行 `git push -u origin <branch>`（禁止 force push）。
6. **active PR 檢查**：依 adapter `createPullRequest` 章節的前置檢查查詢同來源/目標分支的 active PR：
   - 存在且為本流程先前開立 → 改走 `TRACKER.updatePullRequest`
   - 存在但**非本流程開立** → **告警停止**：列出 PR 資訊，請使用者確認來源（可能為自動誤發，須人工處置）

### Phase 2: 組裝 PR 內容

呼叫參數（adapter 對應章節見 `.claude/reference/adapters/`）：

```
TRACKER.createPullRequest({
  sourceBranch: <當前分支>,
  targetBranch: <依 SDD workflow 規則「Branch Policy」解析：dev / develop / development>,
  title: <見 Title 規範>,
  description: <Markdown，依 adapter「PR 描述範本」章節，必含項目見下>,
  workItemIds: [<parentId>, <childIds...>],   // 批次模式 → 聚合全批所有父卡 + 各自子任務
  reviewers: <可選；branch policy 已強制 required reviewer 則略>,
  draft: <reviewer 尚未到位時 true，否則 false>,
  autoComplete: false   // 一律 false，禁止 auto-complete（PR 開立控管）
})
```

**Title 規範**：

- 單卡：`<type>(<scope>): <現在式具體描述> #<parentId>`
- **批次最終**：`chore(schedule): 批次完成 <N> 張卡片 #<id1> #<id2> ...`（卡片數多時列前幾張，其餘以「等 N 張」概括；明細放 description）
- `type` / `scope` 依 `commit-message` skill 的「類型」表
- 不附 `[tier-N]`；不用 `WIP` / `DO NOT MERGE` 前綴（改用 `draft: true`）
- ✅ `feat(editor-canvas): add zoom reset button #42`；❌ `修改 canvas 一些東西`

**Description 必含**（基底結構依 adapter「PR 描述範本」章節）：

- 概述 / 主要變動 / 測試 / 手動驗收 / 風險 / 關聯 / 工作項目狀態轉移（`Resolves #<parentId>`；批次模式 → 逐卡列出 `Resolves #<id>`）
- **驗收對照（selfcheck traceability）**：自 Verify PASS 留言複製 AC 對照表（批次模式 → **逐卡分節**列出各卡的 AC 對照表）
- E2E 新增測試清單（檔名 + case 名稱）與 E2E HTML 報告可存取連結
- 批次模式另含「本批卡片清單」表（卡片 / 標題 / Verify 輪次）

### Phase 3: 人為介入點（雙路徑）

開立前先做**防護狀態檢查**（稽核欄位用）：

- Claude Code：`Read` `.claude/settings.json`，確認 `permissions.ask` 含三條 PR 防護規則（`mcp__azure-devops__create_pull_request`、`Bash(az repos pr create:*)`、`Bash(gh pr create:*)`）；缺漏 → 防護狀態記「**degraded**」並提醒使用者規則已被移動或刪除
- Copilot / Codex：防護狀態記「n/a（非 Claude Code 環境，僅流程層防護）」

接著展示完整 title / description / work item IDs / reviewers / targetBranch，依路徑執行：

| 路徑 | 條件 | 行為 |
|---|---|---|
| **互動確認** | 本任務鏈**沒有**有效預授權 | 顯示「即將開立 PR，請確認以下內容無誤後輸入「確認」；若需調整請說明修改項，調整後再開立。」→ 收到「確認」/「ok」/「yes」才進 Phase 4；其他回覆 → 調整後重新展示 |
| **預授權** | 使用者已輸入「授權本次全自動開立 PR」（本任務鏈）或「授權本批次全自動開立 PR」（schedule 批次內） | 展示內容後**直接**進 Phase 4，標註「依預授權開立（原文：<引用>，時間：<timestamp>）」 |

預授權判定鐵則：

- 授權語句必須是使用者輸入的原文，且明確含「授權」與「開立 PR」語意；模糊語句（「都可以」「你決定」）**不構成**預授權
- AI **不得**自行補充、改寫或代答授權語句
- 單次授權僅涵蓋本任務鏈的一次 PR 開立；批次授權僅涵蓋該排程批次內的卡片；重開、改目標分支、換任務鏈／批次都要重新授權

### Phase 4: 開立與稽核閉環

1. 呼叫 `TRACKER.createPullRequest(...)`，取得 PR ID 與 URL（批次模式：整批只呼叫**一次**）。
2. 寫稽核留言（展示後依寫入前確認規則處理；預授權模式下沿用該授權，不再暫停）——單卡模式寫該父卡；**批次最終模式對 PR 涵蓋的每張父卡各寫一則**，引用同一 PR URL、同一批次授權原文與時間戳：

```
## [Spex] PullRequest 完成

> PR: <url> | 日期：<DATE>

### PR 確認稽核
- 模式：互動確認 / 預授權
- 確認者輸入原文：「<使用者原文>」（時間：<timestamp>）
- 技術防護狀態：ok / degraded（缺 <規則>）/ n/a
- autoComplete：false（流程禁用）

### 關聯
- 子任務：#<childIds...> | Verify：第 <n> 輪 PASS
```

3. 顯示 PR URL，提示後續 reviewer 流程（合併與 work item 轉移由人類 reviewer 在平台 UI 操作）。
4. **清理暫留的 E2E HTML 報告**：報告連結已附進 PR 後，刪除本機報告目錄（路徑見 testing 規則「E2E HTML 報告」）；`git status --short` 確認 working tree 乾淨。

### Phase 5: 失敗處理

| 情況 | 處理 |
|---|---|
| 分支尚未推送 | 提示使用者授權後 `git push -u origin <branch>`，再回 Phase 1 |
| 建立 PR 失敗（驗證錯誤 / 權限不足） | 完整錯誤貼給使用者，**不**重試相同呼叫；請確認 PAT scope / branch policy |
| Branch policy 強制 required reviewer 找不到對應使用者 | 改以 draft PR 開立，稽核留言註明需手動補 reviewer |
| 已存在本流程先前開立的 active PR | 不重建，改 `TRACKER.updatePullRequest(...)` 更新內容（仍走 Phase 3 確認） |
| adapter 不支援 PR（如 local-file） | 告知使用者，把 PR 內容草稿寫入 `PullRequest` 留言留存，由使用者決定後續 |

---

## Red Flags

- ❌ 無 Verify PASS 就開 PR（或 PASS 後有新 commit 未重驗）
- ❌ 在本 skill 以外呼叫 `TRACKER.createPullRequest`
- ❌ `autoComplete: true`
- ❌ 把模糊回覆（「都可以」）當成預授權；或 AI 自行代答確認
- ❌ 發現非本流程的 active PR 卻未告警就繼續
- ❌ 稽核留言缺「模式 / 原文 / 時間戳 / 防護狀態」任一欄
- ❌ PR 開立後未刪除本機暫留的 E2E HTML 報告目錄
- ❌ MCP 失敗後盲目重試相同呼叫

## Verification

- [ ] Phase 1 五項 Gate 全過（Verify PASS / 任務全 done / 已推送 / active PR 檢查 / 分支合規；批次模式 → 逐卡 Verify PASS + 任務全 done）
- [ ] PR description 含 selfcheck AC 對照表與 E2E 報告連結（批次 → 逐卡分節 + 卡片清單）
- [ ] 批次模式：稽核留言已寫入 PR 涵蓋的每張父卡，引用同一 PR URL 與授權記錄
- [ ] 防護狀態已檢查並記入稽核留言
- [ ] 依正確路徑取得人為確認（互動輸入或有效預授權原文）
- [ ] `autoComplete` 為 false
- [ ] 稽核留言已寫入父卡；PR URL 已顯示
- [ ] 暫留 E2E 報告已清理、working tree 乾淨

## Next Steps

→ 人類 reviewer 審查與合併（ADO UI）；如需修改 PR 內容 → 重跑本 skill（走 `updatePullRequest` 路徑）
