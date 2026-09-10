---
skills:
  - spex-write-spec
  - spex-plan
  - spex-task
  - spex-implement
  - spex-selfcheck
  - spex-schedule
  - spex-fixbug
  - commit-message
  - create-adapter
---

# SDD Workflow 規則

本檔定義流程；驗證指令見 [commands.md](./commands.md)，測試拓撲與證據見 [testing.md](./testing.md)，產品架構與安全要求見 repository `AGENTS.md`。

## 核心原則

- 依使用者已授權的 spec／plan 實作全部 AC、In Scope、邊界與列舉，並保留 Out of Scope。reviewer／verifier 建議不等於新增功能授權。
- 新功能或修改需求先取得確認；已在範圍內的缺陷、補測、拆卡與技術選擇可自行完成。只暫停依賴缺失資訊的工作，獨立工作可繼續。
- 功能缺陷採 Red → Green → Refactor，測試斷言使用者行為或資料不變量，不把矩陣、selector 存在或 build 成功當成功能完成。
- 型別安全優先，避免逃生口、`@ts-ignore`、debugger 與殘留除錯輸出。測試數量與覆蓋率依可執行專案設定，不另訂一源檔一測試檔或泛用百分比。
- 資料查詢遵循 repository `AGENTS.md` 宣告的優先序（自動生成 → 衍生查詢 → 必要的查詢語言 → 最後手寫原生查詢）；保留必要取捨註解與對應測試。
- 保留有效舊測試契約。改寫或移除測試時，須對照已核准規格記錄原保證與替代證據，不以弱化斷言掩蓋缺陷。

## Tracker Adapter（唯一來源）

- **Tracker Adapter: `ado`**

從 `.claude/reference/adapters/README.md` 找到 adapter，只讀使用到的操作章節。ID 與依賴由 tracker 回讀，不依建卡順序猜測。工具不可用時可用該 adapter 支援的 CLI／API；不悄悄更換 tracker 或杜撰狀態。

可選值由 `.claude/reference/adapters/` 下實際存在的 adapter 文件決定。切換 adapter 只需改上面那一行；新增 adapter 走 `/create-adapter`。

## Plan 分析順序

1. 讀取 spec、既有計畫、目前實作與依賴，先確認是否為續行。
2. 將 AC、In Scope、邊界與列舉對映到實作及可執行驗證；`traceability-lint` 只診斷漏項，不證明功能已通過。
3. 盤點既有測試契約存廢與受影響 consumer、fixture、頁面掛載及 API 生成產物。
4. 清楚的單一變更可直接由 plan 進 implement；有獨立切片、多人分工或需持久化依賴才拆 Task。根因已知的缺陷直接規劃；未知才使用根因調查。
5. 將技術計畫與驗證範圍記入 tracker，已授權工作直接續行，不因分類名稱要求再次放行。

## Branch Naming

新工作分支預設 `spex/<摘要>`；批次預設 `spex/schedule-<YYYYMMDD-HHmm>`。使用者指定或既有 tracker 記錄的分支優先，既有分支可沿用，不因命名格式重建歷史。

批次分支與納入的 Epic／Story 清單記在錨點卡 `## [Spex] Schedule 批次分支`；續行讀回原分支與實際 git 狀態，不用今天的日期重推名稱。

## Branch Policy

- 實作在工作分支；已授權的整合分支（`dev` / `develop` / `development`）合併與推送可自動進行。
- **未經使用者明確授權，不得合併到或推送 `master` / `main`。** 授權可涵蓋指定 Epic／批次，驗收通過後自動執行，無須在每次操作前重問。
- 授權依據是使用者訊息。tracker 可保存其原文與範圍作定位，但 agent 自寫的旗標、文件或環境變數不是授權來源；新範圍或使用者撤回授權時須重新判斷。
- 人工授權不代替產品驗收。不得帶入未完成 Epic，不以 force push 或重寫已共享歷史處理分歧；這些操作另需具體授權。

## 分支生命週期

先檢查工作樹與遠端；保留使用者及其他工作的修改。可用隔離 worktree 或只 stage 本次檔案，不因無關 dirty 狀態一律停止，也不擅自 reset／stash／刪檔。

Epic 採一個整合範圍：已核准基線至驗收版本。整理有意義的 Conventional Commits，不固定 commit 數量。整合前確認受測產品內容等於待整合內容；文件紀錄的新 commit 不會單獨使產品證據失效。

## Epic 驗收與整合

### 狀態與順序

| 範圍 | 完成條件 | 後續 |
|---|---|---|
| Task | 本 Task AC 與相關測試通過 | 更新 Task `done` |
| Story 實作 | 全部必要 Task 完成，Story AC 證據已整理 | `Implement 完成`，註明「待 Epic 驗收」；Story 保持 `in_progress`，可滿足下一 Story 的實作依賴 |
| Epic review | 納入 Story 都已實作；對整個 Epic 累積 diff 完成一次 code review | 修復實質問題，只複查修正差異 |
| Epic 驗收 | 完整機器驗證全綠後，一次獨立 verifier 對照 Epic 與所有 Story 全通過 | 更新 Epic 與納入 Story 為 `done`，記錄 Verify PASS |
| 整合交付 | 已授權範圍整合／推送完成，流水線成功 | 另記整合分支與 master SHA 及流水線結果；`done` 不等於已上線 |

單張獨立 Story 沒有 Epic 時，以該 Story 為同一流程的驗收單位。多 Epic 批次依序完成各 Epic 的集中 review、驗證與授權整合，不等全批才交付，也不逐 Story 做獨立驗收。

### 一次整體 code review

納入 Story 全實作完成後，派一次獨立唯讀 code-reviewer，提供規格、整個整合範圍的 diff 與 focused 測試結果。修復範圍內實質缺陷；同一 reviewer 只複查修正差異。無法派發時可由主代理依同一標準審查，明列降級，不能宣稱已獨立 review。

### 完整機器驗證與獨立驗收

review 的實質問題清空後，主代理依 `commands.md` 執行完整驗證指令束，並依 `testing.md` 跑全部本機測試拓撲。保留原始證據並重用未變範圍的有效結果。

全部機器驗證通過後，派一次全新上下文、唯讀 verifier。輸入只有規格、任務、實際 diff 與完整機器證據；逐條確認 AC、In Scope、邊界、列舉、範圍、測試契約與任務完整性。輸出普通 PASS／FAIL 報告及具體證據，不增加前置模型預審或其他交棒程序。

缺口修復後只重跑受影響測試，再交同一 verifier 覆核修正差異與新增證據；不重新掃描未變內容。若原代理不可用，交新代理已完成報告與差異，明確限定續驗範圍，保留其獨立性。

### 授權整合與流水線

1. 驗收通過，檢查最新遠端與待整合範圍；僅把本 Epic 納入整合分支並先推送遠端。
2. 本 Epic 有新 migration 時，push master 前先依 `commands.md` 的 migration 指令對帳、依序套用 migration、確認遠端 migration 狀態與必要 schema，並執行既有的資料庫健檢。不得關閉 schema 驗證或以零散 DDL 繞過。
3. 核對使用者對本 Epic／批次的 master 授權；有授權則將最新整合分支合併 master 並 push，沒有就回報驗收及整合分支結果、等待該項授權。
4. 依 repository 既有設定觸發 CI／CD 流水線；不繞過流水線直接手動部署。記錄兩個 push SHA 與 run 結果，失敗立即調查修復，不宣稱已上線。
5. 整合成功後回原批次分支，同步已整合節點，再續下一 Epic。所有瀏覽器驗證都是本機驗收，不新增線上 URL 測試。

## Definition of Done

- 明確納入範圍的 AC／In Scope／邊界／列舉有真實可執行證據，所有必要 Task 完成。
- 一次整體 review 的實質問題已處理，完整機器驗證與獨立驗收通過。
- 無未解決產品失敗、漏項、假綠或未授權擴充；Out of Scope 按實際 diff 查核。
- 交付要求包含整合時，另確認授權範圍、migration 與流水線結果。不得用「等待」或文件宣稱代替結果。

## Fail 判定

測試失敗或需求未達成就是未完成；不可 skip、偽造輸出、將失敗改寫為 PASS。先以錯誤證據定位產品、測試契約或環境原因，再修復與重驗。

不設固定分鐘數、失敗次數或模型輪次停損；只要有可驗證的根因或下一步，就繼續工作。缺必要資訊、外部條件、scope 決定或 master 授權時，只暫停依賴該條件的部分並清楚回報。可用本地證據解決的問題不強制查外部，也不因特定 MCP 缺少而停工。

文件格式或路徑錯誤直接修正文件／工具，只重跑相關檢查；不產生產品 Fail，不重跑已全綠產品測試。既有歷史 FAIL 保留，是否仍阻擋由其實質缺口與最新有效證據判定。

## 進度與證據

tracker 保存範圍、分支、Task 狀態、Story 實作狀態、Epic review／Verify 與整合結果；讀取以最新數字 seq 的 entry 為準，既有歷史不改寫。已授權的留言、子卡與狀態更新直接完成，不逐筆等待確認。

測試證據可保存在 gitignored 本機目錄，細節見 `testing.md`；tracker 要保存可定位的 commit、指令、結果與報告位置。中斷續行先讀 tracker 和實際工作樹，確認原工具程序狀態，不憑過時記憶重新啟動。

## ID 事實鐵則

- Tracker item ID（含子卡編號）必須由 tracker 讀回，禁止依建卡順序、上一張卡編號或分支名推斷；自動編號可能被其他資料或已刪項目占號。
- commit 訊息、留言、分支名中引用的 ID 在寫入前須與 tracker 回讀值核對一次。

## 架構與路徑映射

- 依 repository `AGENTS.md` 與既有目錄慣例放置程式碼：業務按 feature 收斂，真正跨功能共用才進共用層；通用 UI 沿用既有設計系統。
- 資料查詢遵循 `AGENTS.md` 的優先序；必要的手寫查詢保留理由與對應測試。
- API 契約變更後以 codegen 更新生成的 client，不得手改；schema、權限、索引與觸發器透過 migration 管理，維持既有 schema 驗證。

## File Zones

產品碼、測試碼、規格／流程紀錄分別依 repo 現有目錄存放。只提交本次範圍，credential、環境檔、build output 與可還原測試暫存物不得 commit。保留使用者既有素材及其他工作的修改。

## 程式碼導航策略

搜尋先使用 `rg`／`rg --files`；有語意導航工具時可直接查定義與引用，沒有時不要求安裝。只探索與問題相關的程式與 consumer，跨 repo 指令明確指定 working directory。

## 多 Repo 執行紀律

任務涉及多個 repo 時，shell 的 `cd` 會殘留到後續指令，是跑錯目錄的最大來源。

- 一律帶絕對路徑：git 用 `git -C <repo 絕對路徑>`；npm 用 `npm --prefix <repo 絕對路徑> run <script>`，或在同一次 shell 呼叫內 `cd <repo 絕對路徑> && <指令>`，不依賴前一次呼叫的 cd。
- 驗證指令束執行前先比對目標 repo；輸出異常（missing script、no tests）先懷疑目錄錯誤再懷疑程式。
- 各 repo 的驗證指令束與分支操作分開執行、分開確認結果；不以一條指令鏈混跨兩個 repo 的驗證。
- `commands.md` 應記錄各 repo 根目錄絕對路徑。

## 教訓回收與升級

按當前問題讀取相關 active 教訓，不把歷史方案當現行指令。新教訓只記可重用根因與產品防護，先去重；不因每次格式修正或 Fail 強制新增文件。已移除流程對應的教訓檔與索引列直接刪除，不保留退場本文增加上下文；混合教訓只留仍有效的產品根因與防護。格式單一來源見 `.claude/reference/spex/lessons-template.md`。
