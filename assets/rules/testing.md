---
skills:
  - spex-plan
  - spex-task
  - spex-implement
  - spex-selfcheck
  - spex-pull-request
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
- `## TODO: [補充專案特有的 E2E 慣例，例如匯入路徑限制、導航等待策略、本地/CI dev server 復用策略]`
- 建議流程：先用 UI 驗證工具探索真實流程與 DOM → 再依 E2E 框架慣例產出測試。

## UI Verification（UI / 佈局 / 拖放 / 視覺反饋類任務 commit 前必走）

與「程式化斷言 PASS」並列、缺一不可。

| 步驟 | 做法 |
|---|---|
| 啟動 dev server | `## TODO: [檢查/啟動指令，如 lsof -i :<port> 檢查；無則啟動並等待就緒訊息]` |
| 真實渲染走流程 | UI 驗證工具導覽 → 逐步操作互動元素 |
| 逐項截圖比對 AC | 每條 AC 對應 1 張截圖，用 Read 看圖確認視覺與 AC 文字一致 |
| console 監聽 | 瀏覽器 console 不可有新 error / warn |

任一項不符 → 退回 Refactor 修真實渲染，**不可**用單元 / 整合 / E2E spec PASS 替代。
