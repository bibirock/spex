---
name: spex-plan
description: >-
  將完整規格轉成技術計畫、AC 測試對映與工作分支；依實際依賴決定是否拆 Task。
  根因不明的缺陷先交 spex-fixbug。前置：規格就緒。後續：必要時 spex-task，否則 spex-implement。
---

# Spex: Plan — 技術實施計畫

## 載入與前置

- 讀取 `.claude/rules/sdd-workflow.md` 的「核心原則」「Tracker Adapter」「Branch Naming」「Branch Policy」「分支生命週期」「Plan 分析順序」「架構與路徑映射」「File Zones」「程式碼導航策略」。
- 讀取 `.claude/rules/commands.md` 與 `.claude/rules/testing.md`，採用其中測試層級與指令。
- 讀取 [spec-template](../../reference/spex/spec-template.md) 的必填章節與品質檢核清單。
- 依 [Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 定位目前 adapter，只讀本次操作的同名章節。
- 使用 `TRACKER.readItem` 讀規格、父 Epic、AC、附件與既有流程紀錄；`TRACKER.findSpecComment` 取既有 Plan / Fixbug。
- 從使用者指定、tracker 或既有分支取得真實 ID；不臆造 ID、不搬移歷史 specs。
- 已有有效計畫時只補本次變更，已授權流程直接續行；僅實質規格衝突或缺少必要輸入才詢問。

## 1. 確認完整需求與驗收單位

逐項讀取 Persona、In Scope、Out of Scope、AC、邊界條件、列舉完整性與驗收場景。
並列條件必須拆成可檢查項，不能只實作其中最容易的一項；規格有圖片時實際檢視可取得的附件。
規格不足以決定行為時，先完成不受影響的探索，再由 `spex-write-spec` 補必要資訊。

- 有 Epic：記錄本批範圍、所有納入 Story、Epic 自身 AC 與跨 Story 依賴；Epic 是整體驗收單位。
- 無 Epic：以此單卡作為驗收單位。
- Story 完成 AC 的 focused TDD 與相關回歸即可記錄「Implement 完成待 Epic 驗收」。
- 該狀態可滿足後續 Story 的實作依賴；需要實際部署或外部事件的依賴仍須取得對應事實。
- Epic 所有納入 Story 實作完，再集中 review、完整測試與獨立驗收。

## 2. 定位影響面與缺陷根因

依 Plan 分析順序從可見入口追到狀態、API、資料、契約與測試，列出具體檔案和可複用能力。
資料存取遵循 repository `AGENTS.md` 的查詢優先序；必要的手寫查詢要有具體理由與對應測試。
前後端業務依 repository 既有慣例按 feature 收斂，伺服器狀態與通用 UI 沿用既有方案，不另建平行機制。

缺陷根因已有程式碼與重現證據時直接規劃修復；根因不明才使用 `spex-fixbug`，不因規模或類型強制多走一站。
涉及 migration、認證、安全或外部整合時規劃必要驗證與授權邊界，不因分類本身停工。
工具不足時先用本機程式碼、測試與可用替代工具解決，記錄剩餘資訊缺口。

## 3. 盤點既有測試契約

依入口、route、可見文案／role、API path、fixture 搜尋既有單元、整合與 E2E 情境。
新增掛載請求時反查所有進入該頁面的 E2E mock；新增重複資訊時檢查 locator 歧義。
有狀態 fixture 應避免共用配額、資料或流程狀態而造成互相污染。

| 情境／測試位置 | 保護的產品保證 | 本次影響 | 處置與替代證據 | 理由 |
|---|---|---|---|---|
| 可搜尋的 test title | 對應規格／不變量 | 流程或契約變更 | 保留／改寫／合併／移除 | 產品依據 |

有效保證必須保留；合併須有等價證據，移除須有明確廢止行為的依據。
不能為保住過時測試而扭曲新規格，也不能為測試全綠刪除有效斷言。
純內部重構且對外契約未變，可簡述證據後標明本節不適用。

## 4. 設計實作與測試

計畫包含：

1. 資料流、狀態與錯誤處理、元件責任、API／schema 變更及相容性。
2. 新增／修改／移除檔案與各自用途，避免加入未授權功能。
3. 每條 AC、In Scope、邊界與範圍內列舉成員對應的實作位置與可執行測試。
4. focused TDD 的預期失敗、成功條件及相關回歸集合；依風險選測試層級。
5. Epic 最終完整驗證的場景、fixture 與跨 Story 契約。

UI AC 使用 `.claude/rules/testing.md` 指定的 E2E／UI 驗證工具，斷言可見結果、互動、API 邊界與 console error/warning。
涉及檔案處理或多階段流程的成功路徑，須由實體 fixture 走完整條使用者鏈到最終可觀察結果。
本機驗證拓撲與正式表面契約依 `.claude/rules/testing.md`；本機替身不得被當成真實外部帳戶登入。
API 契約變更規劃重新 codegen，禁止手改生成的 client；schema 變更規劃 migration 與權限／整合驗證。

## 5. 決定必要的 Task 與建立分支

- 能以清楚的單一 AC 集合直接實作：Plan 列明步驟與測試後交 `spex-implement`。
- 有可獨立驗證切片、多人責任分工或需持久化的依賴：交 `spex-task` 拆解。
- 不以檔案數、估時或技術類型強制拆卡；不為流程建立沒有實作價值的空 Task。
- 依分支規則呼叫 `TRACKER.ensureBranch`；schedule 已有共用分支時沿用，不另建逐卡分支。
- dirty tree 先辨識並保護現有修改；可安全隔離時繼續，不重置他人工作。

## 6. 記錄與交棒

用 `TRACKER.addComment` 追加「`## [Spex] Plan 完成`」，保留既有歷史。
記錄規格來源、Epic／單卡驗收單位、技術決策、檔案清單、測試對映、依賴、分支與下一步。
分類和格式只服務後續執行；可判讀的文件不因純格式問題停住實作。
需要時執行 `.claude/reference/spex/scripts/traceability-lint.mjs` 協助找需求遺漏，逐項判讀結果；對映表不能替代實際測試。

必要拆解完成後進 `spex-task`，其餘直接進 `spex-implement`；沿用使用者已給的執行授權。
驗收通過不代表取得 master 整合授權，master merge／push 必須有使用者明確授權。
