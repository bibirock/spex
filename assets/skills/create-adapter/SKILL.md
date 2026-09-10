---
name: create-adapter
description: 建立或更新 Tracker Adapter 文件與對應設定。先讀 adapter 協定，實作 10 個核心操作及必要擴充，讓 Spex 以 Epic 集中驗收與授權整合流程使用該 tracker。
---

# Create Adapter — 建立 Tracker Adapter

## 讀取與範圍

先讀 [協定](../../reference/adapters/README.md)，再讀 `.claude/rules/sdd-workflow.md` 的 Tracker Adapter、Branch Naming、Branch Policy 及 Epic 驗收與整合。
更新既有 adapter 時先讀實際文件；只修改使用者要求的系統，不切換在途工作或覆蓋既有憑證與連線設定。

## 蒐集必要資訊

從現有設定與可用工具取得 tracker ID、工作區、型別／需求與缺陷路線、欄位格式、狀態、繼承欄位與依賴能力。
未知且無法從環境取得的資訊一次詢問；已有授權範圍直接實作，不逐章要求確認。
工具名和參數須依當前可用 schema；MCP 不可用可使用同系統的受支援 CLI／API，不杜撰呼叫。

## 10 個核心操作

每個操作必須有與協定同名的 `## TRACKER` 章節，列輸入、輸出、欄位映射、實作方式及失敗處理。

| 操作 | 實作責任 |
|---|---|
| `TRACKER.readItem(id)` | 基本欄位與 type → 需求／缺陷路線 |
| `TRACKER.findSpecComment(id, phase)` | 最新有效階段留言，Verify 完成與 Fail 都可讀 |
| `TRACKER.addComment(id, content)` | 按系統格式追加，不覆寫原始驗收歷史 |
| `TRACKER.ensureBranch(params)` | 沿用既有工作／批次分支；新建依 workflow 命名 |
| `TRACKER.createChildTask(params)` | 建立 Task、連結父卡、回讀真正 ID |
| `TRACKER.updateTaskState(id, state)` | Task／Story／Epic 狀態與原生系統映射 |
| `TRACKER.getParentMetadata(id)` | 父卡繼承欄位 |
| `TRACKER.getParentImages(id)` | 附件片段與相對路徑；無附件回空陣列 |
| `TRACKER.linkDependency(predecessorId, successorId)` | 冪等的前置／後繼依賴 |
| `TRACKER.getDependencies(parentId)` | 全部子任務、實際狀態與依賴邊 |

必填操作不支援時保留章節，明列原因與可行替代方式。可選擴充使用系統命名空間；`recordBenchmark` 為既有選用協定操作。

## 文件與設定

- 單檔放 `.claude/reference/adapters/<id>.md`；有附件工具或範本時放 `<id>/<id>.md`。
- 文件要有實作總覽、欄位格式、路線對映、ID 規則、狀態對映、規格建卡欄位對照、連線限制與 10 個核心操作。
- 說明頂層 spec／Epic／Story 建卡型別與父子關係；不支援就明說，不能只提供 Task 建卡卻假稱支援頂層。
- Story focused 驗證完成後記「待 Epic 驗收」，仍 in-progress 且可滿足後續實作依賴；Epic 集中 Verify PASS 後同步 Epic／Story done。done 不等於已交付。
- 已授權留言、Task 與狀態更新直接執行。master 合併／推送須有使用者對 Epic／批次的明確授權，既有授權有效；文件或 agent 旗標不是授權來源。
- 按使用者要求更新 workflow 的 Tracker Adapter 選擇與 README 對照；需要新增連線設定時保留其他設定，憑證只引用環境，不寫入文件或 log。
- 不安裝 Spex 專用工具封鎖或另一套確認機制。不要移除產品測試、安全檢查或使用者自訂的無關設定。
- 同一份 adapter 會落地到各代理平面（`.claude/`、`.codex/`、`.spex/`）。多平面並存時同步語意，並各自使用該平面正確的相對路徑。

## 驗證與交付

核對 10 個操作簽名、輸出、文件連結、設定檔可解析與剩餘工具實測。
用多 Story Epic、修復後 delta 複核、純文件變更與舊批次續行核對路由。
核對未授權 master 停在該操作；指定批次已授權則驗收後執行，不再追問。
回報變更檔案、測試結果及無法驗證的連線限制，再依已授權工作接續 `spex-plan`／`spex-schedule`。
