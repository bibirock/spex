---
name: spex-implement
description: >-
  依 Story AC 與必要 Task 執行 focused TDD、相關回歸並保存實作進度。
  前置：spex-plan 或 spex-task。後續：繼續 Epic 下一 Story；全部實作就緒後交 spex-selfcheck。
---

# Spex: Implement — Story focused TDD

## 載入與前置

- 讀取 `.claude/rules/sdd-workflow.md` 的「核心原則」「Tracker Adapter」「Branch Naming」「分支生命週期」「Epic 驗收與整合」。
- 讀取 `.claude/rules/commands.md` 的「驗證指令束」與 `.claude/rules/testing.md`，按層級選擇指令。
- 依 [Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 讀 `readItem`、`findSpecComment`、`getDependencies`、`updateTaskState`、`addComment` 的對應章節。
- 讀 Story、Epic、Plan、必要 Task 與最新進度；沒有 Task 但 Plan 可直接執行時正常續行。
- 核對工作分支及 working tree，保護他人修改；schedule 沿用共用分支。
- 已授權範圍內的實作、測試與 tracker 同步直接推進，不重新詢問階段確認。

## 1. 確認實作順序

依 tracker 真實依賴決定可執行 Task／Story，不依對話記憶推測完成狀態。
「Implement 完成待 Epic 驗收」可滿足後續 Story 的實作依賴；部署或外部事件依賴仍看實際證據。
有 Task 就逐張完成；無 Task 就以 Plan 的 AC 切片執行，兩者使用相同品質要求。
可平行的獨立工作可交代理，指定檔案責任並告知其他人也在修改；共用檔案和固定測試拓撲須協調。

## 2. 逐 AC 執行 Red → Green → Refactor

### Red

先建立或調整能證明需求尚未成立的 focused 測試，實際執行並記錄預期失敗。
缺陷測試必須重現症狀或保護同一產品保證；環境錯誤、編譯錯誤不冒充有效 Red。
既有測試已能證明缺口時沿用，不為留痕再寫鏡像測試；低影響文字／流程調整使用有意義的檢查。

### Green

實作符合完整 AC、In Scope、邊界與列舉清單的最小改動，執行 focused 測試直到通過。
不能刪除有效斷言、偷偷 skip、降低測試強度或縮小產品範圍來取得綠燈。
保持 repository `AGENTS.md` 的 feature 邊界、資料存取優先序、既有伺服器狀態方案、通用 UI 慣例與認證限制。
API 契約改動先更新來源再執行 client codegen，禁止手改生成的 client。
schema 變更以 migration 管理，補對應整合／權限測試，維持既有 schema 驗證。

### Refactor 與相關回歸

focused 測試通過後整理本次程式碼，重跑受影響測試及 Plan 指定的相關回歸。
發現影響面擴大時補相應回歸；已綠且未受影響的證據可沿用，不逐 Task 重跑全量。
既有測試依 Plan 的保留／改寫／合併／移除決策處理，保留仍有效的使用者保證。
實作階段不逐 Task／Story 派整體 review，集中在 Epic 全部實作就緒後進行。

## 3. UI 與整合證據

- UI AC 使用 `.claude/rules/testing.md` 指定的 E2E／UI 驗證工具，驗證使用者可見結果、互動、API 邊界和 console error/warning。
- 涉及檔案處理或多階段流程的成功路徑，用實體 fixture 走完整條使用者鏈到最終可觀察結果。
- 只看到中途某一步成功不能算完整成功路徑；格式拒絕、超限等失敗不虛構後續產物。
- 視覺 AC 的截圖實際檢視；不能用 selector 存在、靜態搜尋或手動瀏覽替代規格要求的自動化驗證。
- 本機驗證拓撲與正式表面契約依 `.claude/rules/testing.md`；本機替身不得被宣稱為真實外部帳戶登入。
- 同一固定 port／同一測試拓撲的命令必須串行；讀取 build 產物的檢查等 build 完成。
- 測試報告保留供 Epic 驗收與整合查閱，其他暫存物不進版控。

## 4. 失敗處理

測試失敗先判定產品缺陷、測試契約過時或環境問題，以具體證據修正原因。
只重跑受修正影響的測試；runtime、fixture、helper 或拓撲改變時補相應整合驗證。
持續處理已授權且可解決的問題，不以固定時間或重試次數中止。
可由本機解決的工具問題直接替代；migration／security 等分類本身不構成停工理由。
實質 scope 衝突、缺少不可替代輸入或超出外部操作授權時，記錄具體缺口並繼續無關工作。
review／verifier 的範圍內缺失直接修復；新增產品功能建議只列待確認，不自行加做。

## 5. 保存完成事實

Task 的 focused TDD 與相關回歸通過後，才用 `TRACKER.updateTaskState` 更新子任務狀態。
`removed` 必須記錄被取代或廢止的需求依據，不能丟掉仍需交付的 AC。
適用時按 repository commit 規範保存有意義的變更，不改寫其他人的歷史或提交暫存產物。

Story 全部實作完成後，`TRACKER.addComment` 追加：

```markdown
## [Spex] Implement 完成
- 階段：Implement 完成待 Epic 驗收
- 驗收單位：<Epic ID；無 Epic 時為本卡>
- 已完成 AC／Task：<完整清單與真實 ID>
- 變更與 focused TDD／相關回歸：<指令、結果、證據位置>
- 依賴就緒：<後續 Story 可使用的契約>
- 未完成事項：<明確列出；無則填無>
```

此時 Story 仍屬待驗收，不將其宣稱 Verify PASS 或已部署。
有未完成 AC 時保存實際進度，不能寫成 Implement 完成。

## 下一步

Epic 尚有未完成 Story：依依賴繼續下一張；全部實作就緒後交 `spex-selfcheck`。
無 Epic：以本卡交 `spex-selfcheck`。
驗收單位最後才集中一次整體 review、`.claude/rules/commands.md` 的完整驗證指令束與獨立 verifier。
master merge／push 僅在使用者已明確授權此 Epic／批次時可進行，驗收結果不擴張授權。
