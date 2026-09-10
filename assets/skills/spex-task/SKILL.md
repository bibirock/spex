---
name: spex-task
description: >-
  將需要依賴或責任拆分的 Story 技術計畫轉成可執行的 AC focused TDD 任務。
  前置：spex-plan。後續：spex-implement。簡單 Story 可直接由 plan 進 implement。
---

# Spex: Task — 必要的任務分解

## 載入與前置

- 讀取 `.claude/rules/sdd-workflow.md` 的「核心原則」「Tracker Adapter」「Branch Naming」「架構與路徑映射」「File Zones」。
- 讀取 `.claude/rules/commands.md` 與 `.claude/rules/testing.md`，區分 Story focused 驗證與 Epic 完整驗收。
- 依 [Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀目前所需操作章節。
- `TRACKER.readItem` 取得 Story／Epic 規格；`TRACKER.findSpecComment` 取得最新 Plan 與已有 Task。
- `TRACKER.getDependencies` 取得真實子卡與依賴，必要時 `TRACKER.getParentMetadata`、`TRACKER.getParentImages` 取得繼承欄位與圖片。
- 使用既有 ID、分支與授權；已拆好的任務直接核對與續行，不重建卡片。

## 1. 判斷是否需要拆解

只在單一 Story 存在獨立切片、責任分工或實作依賴時使用此階段。
若 Plan 已足夠清楚且不需子卡，直接把它交給 `spex-implement`，不補儀式性的 Task。
每張 Task 應產生可檢查的行為或必要技術能力，避免只按技術層切出無法驗證的空層。
技術前置可獨立成卡，但必須列出提供給後續切片的契約與 focused 測試。

## 2. 從完整規格分配責任

逐項核對 Story 的 In Scope、AC、邊界條件、列舉成員與 Plan 的既有測試處置。
並列條件分別對映；同一 AC 可跨 Task，但要指定完成該 AC 的整合責任。
父 Epic 的跨 Story 驗收項保留在 Epic 驗收清單，不重複塞入每張 Task。
Out of Scope 是實作邊界，review 建議不得自行轉成新增功能。

| Task | 使用者結果／技術契約 | 對應需求 | 依賴 | focused 測試／相關回歸 |
|---|---|---|---|---|
| T-001 | 可觀察的結果 | AC／邊界／列舉項 | 真實前置卡或無 | 指令與 test title |

不因同一需求已在另一 Task 提到而省略尚未覆蓋的分支；不為維持卡片數量拆出重複工作。

## 3. 撰寫可執行任務

每張 Task 保留以下必要資訊，標題與版面可依 adapter 調整：

- 目的與範圍：要交付的結果、對應 Story AC 與不包含的工作。
- 責任檔案：新增／修改／移除位置；共用檔案需說明協調方式。
- 前置依賴：需要的契約或狀態，區分實作就緒與必須部署才成立的依賴。
- Red：證明缺少需求或可重現缺陷的 focused 測試，以及預期失敗原因。
- Green：讓該行為成立的最小實作。
- Refactor：維持行為後整理結構，重跑受影響的 focused 測試與相關回歸。
- 完成條件：使用者可觀察斷言、API／資料邊界、測試指令和證據位置。

UI 使用 `.claude/rules/testing.md` 指定的 E2E／UI 驗證工具；涉及檔案處理或多階段流程的成功路徑須以實體 fixture 走完整條使用者鏈。
失敗路徑若沒有產生後續產物，不要求虛構後續成功流程。
資料庫、認證、安全相關 Task 保留對應整合／權限測試，不因類型要求額外人工關卡。
API 契約變更透過 codegen 更新前端 client，禁止手改生成檔。

## 4. 檢查覆蓋與依賴

- 檢查所有有效需求都有責任卡與實際可執行的證據計畫。
- 驗證依賴無循環，沒有引用不存在的卡；可由現有規格解開時直接調整。
- `node .claude/reference/spex/scripts/traceability-lint.mjs <spec.md> <task.md>` 可輔助診斷需求遺漏。
- lint 的文字解析或格式問題只修文件／解析輸入，不視為產品失敗或自動停工條件。
- 真實的需求、依賴或測試缺口必須補齊；表格完整與 lint 通過都不能代替測試。

## 5. 建卡與記錄

依已授權的計畫執行 `TRACKER.createChildTask`，使用 adapter 要求的內容格式與父級欄位。
保存工具實際回傳的 ID；全部卡片建立後用 `TRACKER.linkDependency` 寫入必要依賴。
`TRACKER.addComment` 追加「`## [Spex] Task 完成`」，包含任務摘要、需求對映、真實子卡 ID 與依賴。
已有卡片時只補必要內容與缺少的連結；不要重建或覆寫舊流程歷史。
授權已涵蓋的建卡、留言與依賴同步直接完成，不逐筆再問確認。

## 完成與交棒

所有需求都有清楚責任、必要 Task 與依賴已保存，即交 `spex-implement`。
Task 完成只跑 focused TDD 與相關回歸，不逐卡啟動全量測試或整體 code review。
Story 全部任務完成後標記「Implement 完成待 Epic 驗收」，可解除後續 Story 的實作依賴。
待 Epic 所有納入 Story 實作完成，由 `spex-selfcheck` 集中 review、完整測試、一次獨立 verifier。
無 Epic 的單卡以自身作驗收單位；任務清單格式不另設純格式硬閘。
