---
name: spex-selfcheck
description: >-
  在 Epic 全部 Story 實作就緒後集中一次整體 code review、完整機器驗證與一次全新上下文 verifier。
  無 Epic 時驗收單卡。前置：驗收單位 Implement 完成。後續：依授權整合或保存待整合結果。
---

# Spex: Selfcheck — Epic 集中驗收

## 載入與前置

- 讀取 `.claude/rules/sdd-workflow.md` 的「核心原則」「Tracker Adapter」「Epic 驗收與整合」「Branch Policy」。
- 讀取 `.claude/rules/commands.md` 的「驗證指令束」與 `.claude/rules/testing.md` 的「測試框架」「E2E / UI 驗證工具」。
- 依 [Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 讀本次 `readItem`、`findSpecComment`、`getDependencies`、`updateTaskState`、`addComment` 操作。
- 驗收單位為 Epic 與其所有納入 Story；無 Epic 時以單卡驗收。
- 全部 Story 必須已完成完整 AC 的 focused TDD 與相關回歸，尚未實作完則回 `spex-implement` 續做。
- 沿用既有授權、實作紀錄與可適用的機器證據，不改寫歷史規格。

## 1. 收集驗收輸入

收齊 Epic／Story 的 In Scope、Out of Scope、全部 AC、邊界、列舉清單及必要 Task。
取本驗收單位的實際 diff、基準 commit、待驗收 commit／working tree 差異、focused 測試紀錄。
所有子卡必須有真實狀態；移除卡片須有需求已被取代或廢止的依據，仍有效的需求不得消失。
`.claude/reference/spex/scripts/traceability-lint.mjs` 可輔助找漏項，但文件格式問題不阻擋機器測試，對映文字不能替代可執行證據。

## 2. 一次整體 code review

對驗收單位的完整 diff 派一次 `code-reviewer`，檢查行為正確性、回歸、架構慣例與需求範圍。
提供規格與實際 diff，不讓 reviewer 順手新增未授權功能。
review 的範圍內缺失由 `spex-implement` 修正並補 focused 測試；修正後只複查 delta 與受影響契約。
不逐 Task 或逐 Story 重做整體 review，不因報告格式修正重掃未變程式。
待影響交付的 review 缺失處理完成，再執行完整機器驗證。

環境沒有原生子代理機制時，改以另起唯讀對話執行同一份 reviewer 規範，並明列此降級；不得宣稱已完成獨立 review。

## 3. 完整機器驗證

由主編排者依 `.claude/rules/commands.md` 的完整驗證指令束與 `.claude/rules/testing.md` 的測試拓撲執行一次完整驗收，涵蓋：

1. 建置與型別檢查。
2. 單元／整合測試與正式產物建置。
3. 全部本機 E2E／UI 拓撲，含正式表面契約驗證。
4. 讀取建置產物的檢查；依產物依賴等相應 build 完成後執行。

同一測試拓撲／固定 port 串行執行，不讓測試互相關閉 server。
保存實際指令、exit code、通過／失敗／skip 數量、log／report／截圖位置與適用的程式版本。
完整測試有失敗時先修原因、補受影響回歸，取得足夠證據後才派 verifier。
不能靜默 skip；原有條件式排除也需列明理由，不能拿它豁免仍有效的 AC。
真實外部帳戶的人工 gate 只限該外部互動，不擴大豁免可自動化的本機正式表面契約。

UI AC 要有可見結果、互動、API 邊界與 console error/warning；視覺截圖必須實際檢視。
涉及檔案處理或多階段流程的成功場景要由實體 fixture 走完整條使用者鏈到最終可觀察結果。
所有瀏覽器驗證均為本機；本機替身、mock callback 或靜態搜尋不等同真實登入／端到端成功。

## 4. 一次全新上下文 verifier

機器證據完整且通過後，才派獨立 `verifier` 子代理，使用全新上下文、不繼承實作對話；派發時要求先讀取 verifier 定義與本 skill，並等待實際結果。
環境沒有原生子代理機制時，改以另起唯讀對話執行同一份 verifier 規範，並明列此降級。

只提供規格、必要 Task、實際 diff、機器輸出與證據位置；不提供實作推理、對話歷史或上游通過結論。
驗證者依 `verifier` 定義的唯讀規範，逐項回報 PASS／FAIL 與證據：

| 檢查 | 要確認的事實 |
|---|---|
| 完整需求 | Epic／Story 全部 AC、In Scope、邊界、列舉成員都有實作與有效可執行證據 |
| 使用者結果 | 測試真的操作並驗證結果，UI 成功鏈及錯誤邊界完整 |
| 既有保證 | 有效舊契約保留，沒有弱化斷言、未說明 skip 或不實替代證據 |
| 範圍與任務 | diff 沒有未授權功能；Task／Story 沒有靜默遺漏，必要依賴成立 |
| 完整驗證 | 建置、單元、各本機 E2E 拓撲與產物檢查都有適用且成功的結果 |

verifier 以已提供的機器證據判讀，必要抽查限疑點的 focused 證據，不自行重跑全套。
等待 verifier 實際回報，不替它編寫 verdict 或提前宣稱驗收通過。

## 5. 修正與證據重用

任一實質 FAIL 列出規格項、程式／測試位置、失敗原因與所需修正，回 `spex-implement`。
完成修正後只讓同一 verifier 覆核 delta 與更新的證據，不再派全新代理重掃未變範圍。
依 diff 與實際影響決定需重跑的測試；未受影響且仍適用的完整驗證證據繼續沿用。
runtime、依賴、fixture、helper 或拓撲的改動可能影響整合證據，須補受影響集合。
僅報告排版、路徑或純流程文件修正，不重跑產品測試；但不能藉改報告掩蓋真實測試缺口。
不設固定時間或重試次數硬停；缺少必要外部輸入時明記限制，不虛構 PASS。

## 6. 記錄與交棒

驗收通過須同時滿足：整體 review 缺失已解決、完整機器驗證全綠、verifier 全部 PASS。
用 `TRACKER.addComment` 追加「`## [Spex] Verify 完成`」或「`## [Spex] Verify Fail`」。
保留 verifier 原始結論、逐項證據、完整指令結果、適用版本與未解問題，不改寫其判定。
通過後同步本驗收單位與所有納入 Story 的 Verify PASS／完成狀態，使用 adapter 支援的欄位。

schedule 交回 `spex-schedule` 依該 Epic／批次已授權範圍整合；無整合授權則保存待整合成果。
master merge／push 需要使用者明確授權，已有指定 Epic／批次授權可沿用，不逐階段再問。
