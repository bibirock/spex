---
skills:
  - spex-plan
  - spex-task
  - spex-implement
  - spex-selfcheck
  - spex-schedule
  - spex-fixbug
---

# Testing 規則

> 本檔是可編輯的**專案規則**，由 spex 安裝。**這是測試 / E2E 工具的唯一來源**——spex 系列 skill 引用測試框架、E2E 指令、UI 驗證工具與 artifact 目錄時皆以本檔為準。換測試工具只要改本檔，skill 會自動跟隨；請依專案調整。
> 本檔以 frontmatter 的 `skills:` 宣告**所屬的 skill**，由 spex 安裝時依各工具 scope：Claude Code 把 `skills:` 轉成 `.claude/rules/` 的 `paths:`（指向各 skill 的 `SKILL.md`）、Copilot 轉成 `.github/instructions/` 的 `applyTo:`（指向各 skill 的 `.prompt.md`）、Codex 以 HTML 註解標示（無自動 scope，由 skill 執行時讀取）。如此本規則只在這些 skill 的脈絡相關，不污染使用者的無關工作。調整所屬 skill 只要改本清單。

## 測試框架

## TODO: 以下需根據專案內容調整！

**Framework:** `## TODO: [單元/整合測試框架名稱]`

**Layers:**

| 層次 | 框架 | 用途 |
|---|---|---|
| 單元 / 整合 | `## TODO: [框架]` | 純函式、Store、Composable、工具函式 |
| 元件 | `## TODO: [框架，若適用]` | 元件互動與渲染 |
| 瀏覽器環境模擬 | `## TODO: [框架，若適用]` | 無需真實瀏覽器的 DOM 模擬 |
| E2E | `## TODO: [E2E 框架名稱]` | 完整使用者流程 |

## E2E / UI 驗證工具（skill 引用值）

| 項目 | 值 |
|---|---|
| **完整 E2E 指令** | `## TODO: [你的 E2E 指令]` |
| **E2E 框架 / 匯入** | `## TODO: [E2E 測試框架與匯入路徑]` |
| **UI 驗證工具（瀏覽器互動）** | `## TODO: [瀏覽器自動化工具（MCP 或 CLI）]` |
| **E2E artifact 目錄（commit 前須清理）** | `## TODO: [E2E 執行產生的暫存目錄清單]` |
| **E2E HTML 報告** | `## TODO: [報告檔路徑]` |
| **E2E 設定檔** | `## TODO: [設定檔路徑與重點選項]` |

## 測試檔結構（Colocated）

```
## TODO: 填入專案的實際測試檔配置範例，例如：
src/
  <module>/<Component>.ts
  <module>/__tests__/<component>.spec.ts
tests/
  setup.ts           # 共用 setup 與 globals
```

**命名慣例：**
- 測試檔：`<source-file-name>.spec.ts`（置於同層 `__tests__/`）
- 元件 / Composable / 工具測試：與源檔 colocated 於 `__tests__/`

## E2E 撰寫慣例

- **共用資料庫的 e2e 必須序列化**：多個 e2e suite 打同一個 DB 時，並行 worker 會互刪資料造成偶發紅燈（A suite 的清表掃掉 B suite 的 fixtures）。處理方式：把 runner 的並行度設為 1（各家設定名不同，查你所用 runner 的文件），或改用 per-suite schema / transaction 隔離。
- 使用同一個固定 port／同一測試拓撲的命令必須串行執行；讀取建置產物的檢查必須等 producer build 完成，避免把半成品或互相關閉 server 誤判成產品缺陷。
- `## TODO: [補充專案特有的 E2E 慣例，例如匯入路徑限制、導航等待策略、本地/CI dev server 復用策略]`
- 建議流程：先用 UI 驗證工具探索真實流程與 DOM → 再依 E2E 框架慣例產出測試。

## 執行順序與重驗範圍

1. 開發期間依 Story AC 跑相關單元、資料庫、元件與 E2E 測試；UI 直接驗使用者可見結果、互動狀態、API 邊界與 console。
2. Epic 所有 Story 實作完成、整體 code review 的實質缺口處理後，才執行 `commands.md` 的完整驗證指令束與全部本機測試拓撲。
3. 機器驗證全綠後才進一次獨立 verifier；verifier 閱讀原始結果，不自行重跑完整 suite。
4. 失敗先定位及修正，只重驗受修正影響的 suite／拓撲。維持每個必跑範圍都有適用目前內容的成功證據；影響不明時才擴大回歸。

新 commit 本身不使證據失效。文件／流程紀錄改動沿用產品結果；runtime、測試、fixture、migration、建置或拓撲改動則核對其影響。

## UI Verification

- 涉及檔案處理或多階段流程的成功路徑，使用實體 fixture 由自動化工具走完整條使用者鏈到最終可觀察結果。格式／容量等拒絕路徑不要求不存在的後續產物。
- 視覺 AC 的截圖須實際開啟檢視；保留 console error／warning assertions。非視覺條件不用機械式一條 AC 一張圖。
- 本機替身或 mock 不得宣稱為真實外部帳戶登入；外部真實帳戶互動的人工 gate 只涵蓋不可自動化的該段，不擴大豁免正式表面契約。
- 可用 CLI 或瀏覽器自動化工具探索與執行 UI；手動瀏覽不能取代規格要求的自動化驗證。不要只因缺少互動式工具而停止可用 CLI 完成的驗證。

## 證據與 artifact 保存

每次執行先選定獨立 run 目錄，例如 `## TODO: [本專案的證據保存目錄，如 spex-temp/<epic-id>/<run-id>/]`。保存：受測 commit 與未提交差異範圍、完整命令與 cwd、exit code、測試總數／失敗／略過數、原始 log、測試報告與相關截圖。

- 使用工具原始輸出，不以手填數量代替原報告。不能把 zero tests、只列出測試或環境錯誤當 PASS。
- 在下一個 focused 測試、clean 或 build 前，先把已完成的報告複製到該 run 目錄；可配置獨立 reporter 路徑時直接配置，避免互相覆蓋。
- 原始證據保留至 Epic 驗收及所要求的整合交付完成。tracker 永久保留精簡 AC→測試與結果對照、commit、報告位置、review／verifier 原文及整合結果。
- 測試暫存物與建置產物不 commit；保存必要證據後只清理本次已確認可還原的產物，不使用全面 git clean。
