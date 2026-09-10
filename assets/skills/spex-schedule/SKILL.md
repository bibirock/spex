---
name: spex-schedule
description: >-
  依已授權的卡片清單與依賴，在共用分支逐 Story 實作，按 Epic 集中 review、完整測試與獨立驗收。
  每個 Epic 驗收後依授權整合並保存部署結果，支援中斷續行。前置：規格及批次範圍明確。
---

# Spex: Schedule — 按 Epic 推進批次

## 載入與前置

- 讀取 `.claude/rules/sdd-workflow.md` 的「核心原則」「Tracker Adapter」「Branch Naming」「Branch Policy」「分支生命週期」「Epic 驗收與整合」。
- 讀取 `.claude/rules/commands.md` 與 `.claude/rules/testing.md`，所有瀏覽器驗證均在本機執行。
- 依 [Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 只讀所需操作章節；查詢、欄位、狀態與 ID 以實際 adapter 為準。
- 以使用者指定 ID、tracker 查詢或 adapter 的規格路徑收集範圍，不擅自納入其他產品工作。
- 已有排程／Epic 授權時直接續行；不強制重新進計畫模式或逐階段確認。
- 沒有 master 授權仍可完成本機實作、驗收與可審閱成果；master merge／push 只在明確人工授權後執行。

## 1. 從 tracker 盤點

每次開始、壓縮後續行及 Epic 切換時讀回持久化狀態，核對所有納入卡片：

| Epic／Story | 真實 ID／路徑 | 最新階段 | 依賴 | 下一步／阻礙 |
|---|---|---|---|---|
| 驗收單位與子卡 | tracker 事實 | Spec／Plan／Implement 待驗收／Verify PASS／整合結果 | 真實前置 | 可執行動作 |

保留完整清單與父子關聯，不能只盤點已成功卡片。
有 Epic 時按 Epic 分組；沒有 Epic 的單卡各自作驗收單位，不為流程重寫產品範圍。
檢查既有 Plan、Task、Implement、Verify 與整合紀錄，從真正未完成的階段續行。
既有規格與流程紀錄維持原位置；現行流程不要求重建或搬移歷史。

## 2. 確定依賴與共用分支

優先 `TRACKER.getDependencies` 取得依賴；缺少持久化連結時用已知規格補齊。
同一批使用一個共用分支，名稱與 base 依 Branch Naming／Branch Policy；續行沿用記錄的分支。
不為每張 Story 重建分支，不以日期推算取代既有批次記錄。
先辨識 dirty tree 與其他人修改；需要隔離時安全分開，不 reset／清除他人工作。
記錄批次範圍、Epic 順序、共用分支、整合基準及授權涵蓋範圍。

## 3. 逐 Story 實作

依依賴推進 `spex-plan → 必要的 spex-task → spex-implement`。
Plan 已完整、根因已清楚或 Task 非必要時直接續行，不為分類補額外關卡。
Story 按 AC 執行 focused TDD 與相關回歸，完成後保存「Implement 完成待 Epic 驗收」。
該狀態可解除後續 Story 的實作依賴，不能要求每張先 Verify PASS 才讓同 Epic 繼續。
必須已部署或等待外部事件的依賴仍以實際狀態判斷，不把實作就緒冒充部署完成。

保持全部 In Scope、AC、邊界與列舉成員，維持真實 fixture 走完整條使用者鏈的成功路徑。
有效測試不可削弱或靜默 skip；新增產品範圍建議只記錄，取得必要產品決策後才納入。
每張 Task 完成後保存真實狀態，Story 不提前標記 Verify PASS 或已上線。
不同責任範圍可平行實作；固定 port／固定測試拓撲的命令必須串行。

## 4. Epic 集中驗收

本 Epic 所有納入 Story 實作就緒後，呼叫一次 `spex-selfcheck`：

1. 一次整體 code review；修正後只複查 delta 與受影響契約。
2. `.claude/rules/commands.md` 的完整驗證指令束與 `.claude/rules/testing.md` 的全部本機測試拓撲。
3. 機器驗證全綠後，一次全新上下文 verifier 逐項核對 Epic／Story 完整需求。

缺失修復與必要重測按影響範圍進行；未變且適用的證據沿用，同一 verifier 只覆核修正。
不逐 Task／Story 跑整體 review 或全量，不因純文件格式重做已綠的產品驗證。
Epic 自身及所有納入 Story Verify PASS、子任務有可交代的終態，才進入整合。

## 5. 依授權整合與部署

每個 Epic 通過後立即處理該 Epic 的整合，不必等待整個批次結束。
若目前授權涵蓋該 Epic／批次的整合分支 → master 整合，直接沿用；PASS 本身不產生 master 授權。
沒有 master 授權時先完成以下可審閱準備並保存結果，到 master merge／push 前才需要確認。

1. 核對共用分支的待整合內容，保存本 Epic 驗收 commit 與上一個整合點；其他未完成修改保留在原工作區，需要時使用乾淨的隔離整合 worktree，不因無關 dirty 狀態停工。不得 rebase／squash 改寫證據歷史。
2. 以最新整合分支為基準，只整合本 Epic 相對上一個整合點的差異，排除後續未完成 Epic。
3. 在整合分支依功能目的整理有意義的 Conventional Commits，不固定數量，依授權推送遠端。
4. 本 Epic 有新 migration 時，在 push master 前依 `.claude/rules/commands.md` 的 migration 指令對帳，並依版本順序套用既有 migration。
5. 驗證遠端 migration 狀態與必要 schema 存在，執行既有的資料庫健檢；有影響啟動／資料正確性的問題先修復。
6. 依最新遠端狀態把整合分支合併至 `master` 並 push；此步必須已有明確人工授權。
7. 保存兩次 push 的 SHA 與 CI／CD 流水線 run 及結果；不繞過流水線直接手動部署。
8. 流水線成功後切回原共用分支，同步已整合節點，保留歷史後繼續下一個 Epic。

migration 的正式環境套用須在既有整合授權範圍內；不得讓服務先因缺 schema 啟動失敗。
維持既有 schema 驗證，不用手動零散 DDL 或關閉驗證繞過 migration。
流水線失敗立即記錄並修正，不能宣稱已上線；本流程沒有線上 URL 的 E2E 階段。

## 6. 失敗隔離與續行

可解決的失敗持續修正，不以固定時間或重試次數停工。
migration／security 類型、可替代工具缺少、純流程文件格式，不自動構成 blocked。
必要外部資訊、實質 scope 衝突或未授權操作無法解決時，記錄具體缺口與已完成證據。
仍可繼續其他不依賴該缺口的工作，不虛構完成或擴大豁免。
只在使用者要求時設定排程或監控驅動，不把另設驅動方式當成開始執行的前置。

## 7. 結束前對帳

重新讀回全部卡片，逐張核對需求、Task、Implement、Verify、依賴與整合狀態。
結果包含已完成 Epic／Story、待驗收或受阻項、具體原因、共用分支、SHA 與流水線結果。
任何未完成或未授權整合項都明列，不能把部分成功宣稱整批完成。
持久化最新下一步與所需外部輸入，讓後續從真實狀態續行。
