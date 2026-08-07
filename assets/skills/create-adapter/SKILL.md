---
name: create-adapter
description: >-
  建立或更新 Tracker Adapter 文件，並同步安全/可加性設定編輯。此 Skill 必須先讀取
  .claude/reference/adapters/README.md，依抽象協定引導使用者實作全部 12 個必填操作及可選擴充操作，
  將結果寫回 .claude/reference/adapters/。前置：無。後續：更新 .claude/rules/sdd-workflow.md 或其他
  spex skills 參考。
---

# Create Adapter — 建立 Tracker Adapter 文件

## Overview

架構設計師角色，建立或更新 Tracker Adapter 文件，讓 spex skills 透過 `TRACKER.*` 抽象介面支援新追蹤系統。**不只寫文件**：也負責把新 adapter 接上的安全可加性設定編輯（`.mcp.json`/`.claude/settings.json`、分支命名參數化）。

## When to Use

- ✅ 新增 tracker 系統（GitHub Issues / Jira / Linear …）
- ✅ 既有 adapter 文件缺操作或結構不完整
- ✅ 新增 `type → 路線` 映射
- ❌ 切換要使用的 adapter（改 `.claude/rules/sdd-workflow.md` 的 `Tracker Adapter:` 一行）
- ❌ 一般使用既有 adapter（用 spex-\* skill）

---

## Process

### Phase 1：讀取 Adapter 協定（強制最先）

讀 `.claude/reference/adapters/README.md`，理解：

- Adapter 選擇規則
- 檔案擺放規則（單檔平鋪 / 多檔子目錄）
- **12 個必填 `TRACKER.*` 操作** 的輸入輸出
- 擴充操作命名空間規則
- 寫入前確認規則
- 欄位格式約束
- `type → 抽象路線` 責任邊界
- ID 格式
- **分支前綴宣告要求**：每個 adapter 必須明確宣告自己的分支前綴，見 Phase 2.10
- **規格建卡欄位對照章節格式**：見 Phase 2.11

協定與當前需求衝突 → 先調整 README 再起草 adapter。

---

### Phase 2：蒐集需求（逐項問答）

#### 2.1 基本資訊

- **Adapter ID**：例 `github-issues` / `jira` / `linear`
- **系統名稱**：例 GitHub Issues / Jira Cloud / Linear
- **可用工具**：MCP / REST API / CLI；都沒有 → 改文件型 adapter 或標限制
- **ID 格式**：數字 / slug / UUID / 組合鍵

#### 2.2 欄位映射

| 抽象欄位             | 系統欄位 | 必填         |
| -------------------- | -------- | ------------ |
| `type`               | ?        | ✅           |
| `title`              | ?        | ✅           |
| `description`        | ?        | ✅           |
| `state`               | ?        | ✅           |
| `acceptanceCriteria` | ?        | ✅           |
| `reproSteps`         | ?        | Bug 路線必填 |
| `assignedTo`         | ?        | ⭕           |
| `iterationPath`      | ?        | ⭕           |

#### 2.3 路線映射

`type → 抽象路線`：哪些 type 屬「需求路線」、哪些屬「缺陷路線」。

#### 2.4 寫入欄位格式

| 欄位                           | 格式（HTML / Markdown / Plain） |
| ------------------------------ | -------------------------------- |
| Work Item `description`        | ?                                 |
| Work Item `acceptanceCriteria` | ?                                 |
| 留言內容                       | ?                                 |
| PR `description`（若支援 PR）  | ?                                 |

#### 2.5 狀態映射

| 抽象狀態      | 系統狀態字串 |
| ------------- | ------------ |
| `in-progress` | ?            |
| `done`        | ?            |
| `removed`     | ?            |

#### 2.6 12 個必填操作可行性確認

| 操作                | 可行？ | 對應工具                                | 不可行時的替代                                                           |
| ------------------- | ------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| `readItem`          | ?      | ?                                        | ?                                                                          |
| `findSpecComment`   | ?      | ?                                        | ?                                                                          |
| `addComment`        | ?      | ?                                        | ?                                                                          |
| `ensureBranch`      | ?      | 本地 `git`（與 tracker 解耦，通常可行） | 非 git 倉庫 → 回 `{success:false, reason}`                               |
| `createChildTask`   | ?      | ?                                        | ?                                                                          |
| `updateTaskState`   | ?      | ?                                        | ?                                                                          |
| `getParentMetadata` | ?      | ?                                        | ?                                                                          |
| `getParentImages`   | ?      | ?                                        | 無附件支援 → 永遠回 `[]`                                                 |
| `linkDependency`    | ?      | ?                                        | 無原生依賴連結 → 標限制，以任務留言「依賴」欄為事實來源                  |
| `getDependencies`   | ?      | ?                                        | 無原生依賴連結 → 回 `edges: []`，呼叫端 fallback 留言「依賴」欄          |
| `createPullRequest` | ?      | ?                                        | 系統無 PR → 回 `{success:false, reason}`，標明 pull-request skill 不適用 |
| `updatePullRequest` | ?      | ?                                        | 同上                                                                       |

任一不可行 → 文件中明列限制與替代方案，**章節不可刪**。

#### 2.7 擴充操作（可選）

- 系統是否有 TRACKER 介面不涵蓋的特有能力（附件下載 / 批次匯入 / 特殊查詢 …）？
- 若有，定義擴充操作名稱（必須使用系統前綴命名空間，例如 `GITHUB.*` / `JIRA.*`）

#### 2.8 系統特有注意事項（至少 4 類）

- **連線 / 認證**：token 取得、有效期、scope
- **格式差異**：同系統內不同欄位的格式不一致
- **工具參數差異**：例如 `workItemId` vs `id`、`pullRequestId` vs `prId`
- **限制**：API rate limit、批次操作、附件大小、PR branch policy …

#### 2.9 檔案擺放

| 情況                             | 路徑                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| 只有單一 `.md`                   | `.claude/reference/adapters/<id>.md`                     |
| 含子說明 / 範本 / 附件處理等多檔 | `.claude/reference/adapters/<id>/<id>.md` + 同層附屬文件 |

資訊不足 → 列缺失清單等待補充，**不寫文件**。

#### 2.10 分支前綴

此 adapter 的分支前綴 token（例：`JIRA`、`LINEAR`）——與既有 adapter 查重（`ado.md`→`ADO-`、`local-file.md`→`LOCAL-`），不可重複。這個 token 會被寫進 adapter 文件與 Phase 4.6 提案的 `sdd-workflow.md`/`adapters/README.md` 分支命名編輯。

#### 2.11 規格建卡欄位對照

此 tracker 能否建立**頂層規格項目**（不只是子任務）？能的話填欄位對照（描述 / AC / 工作量 / 型別的系統欄位名稱、預設 workspace-or-project）；只能建子任務（如 `local-file`）→ 明講「不支援」並跳過，不可留白假裝適用。

---

### Phase 3：參考既有 adapter

讀以下兩份做章節格式對照：

- `.claude/reference/adapters/azure-devops/ado.md`（多檔子目錄、含 PR / 擴充操作範本）
- `.claude/reference/adapters/local-file.md`（單檔平鋪範本）

可複用章節結構；不可複製專屬字樣到新 adapter。

---

### Phase 4：起草新 adapter 文件

依下列固定結構：

```markdown
# Tracker Adapter — <System>

**前置條件：** <工具 / API / 權限>

**分支前綴：** `<PREFIX>`

## 實作對應總覽

| 操作                        | 類別 | 對應工具   | 備註                        |
| ---------------------------- | ---- | ---------- | ---------------------------- |
| `TRACKER.readItem`          | 必填 | ...        |                             |
| `TRACKER.findSpecComment`   | 必填 | ...        |                             |
| `TRACKER.addComment`        | 必填 | ...        |                             |
| `TRACKER.ensureBranch`      | 必填 | 本地 `git` | 與 tracker 解耦             |
| `TRACKER.createChildTask`   | 必填 | ...        |                             |
| `TRACKER.updateTaskState`   | 必填 | ...        |                             |
| `TRACKER.getParentMetadata` | 必填 | ...        |                             |
| `TRACKER.getParentImages`   | 必填 | ...        | 無支援 → 永遠回 `[]`        |
| `TRACKER.linkDependency`    | 必填 | ...        | 無原生連結 → 標限制         |
| `TRACKER.getDependencies`   | 必填 | ...        | 無原生連結 → 回 `edges: []` |
| `TRACKER.createPullRequest` | 必填 | ...        | 系統無 PR → 標限制          |
| `TRACKER.updatePullRequest` | 必填 | ...        | 同上                        |
| `<SYSTEM>.<extOp>`          | 擴充 | ...        | （若有）                    |

## 欄位格式約束

| 欄位                           | 格式                    |
| ------------------------------- | ------------------------ |
| Work Item `description`        | HTML / Markdown / Plain |
| Work Item `acceptanceCriteria` | ...                     |
| 留言內容                       | ...                     |
| PR `description`               | ...                     |

## 路線對應

| 原始 type | 抽象路線                |
| ---------- | ------------------------- |
| ...       | `需求路線` / `缺陷路線` |

## 規格建卡欄位對照（write-spec 專用）

<能否建立頂層規格項目；能的話給欄位/型別/預設 workspace-or-project 對照表；不能則明講「不支援，僅子任務」>

## `TRACKER.readItem(id)`

<呼叫方式 / 欄位映射表 / 失敗處理>

## `TRACKER.findSpecComment(id, phase)`

## `TRACKER.addComment(id, content)`

> 寫入前確認規則：必須展示完整留言內容，等使用者輸入「確認」/「ok」/「yes」後才呼叫。

## `TRACKER.ensureBranch(params)`

<本地 git 操作步驟；非 git 倉庫時的處理；分支前綴見文件開頭宣告>

## `TRACKER.createChildTask(params)`

> 寫入前確認規則：同上。

## `TRACKER.updateTaskState(id, state)`

| 抽象狀態      | 系統字串 |
| ------------- | -------- |
| `in-progress` | ...      |
| `done`        | ...      |
| `removed`     | ...      |

## `TRACKER.getParentMetadata(id)`

## `TRACKER.getParentImages(id)`

## `TRACKER.linkDependency(predecessorId, successorId)`

<原生依賴連結呼叫方式；冪等規則；無原生連結時標限制並以任務留言「依賴」欄為事實來源>

## `TRACKER.getDependencies(parentId)`

<子任務清單與依賴邊讀取方式；無連結時回 `edges: []`>

## `TRACKER.createPullRequest(params)`

> 寫入前確認規則：同 `addComment`。僅 `spex-pull-request` skill 可呼叫；`autoComplete` 一律禁用。

## `TRACKER.updatePullRequest(params)`

> 寫入前確認規則：同 `addComment`。

## 擴充操作（可選）

### `<SYSTEM>.<extOp>(args)`

<用途 / 步驟 / 範例>

## 系統特有注意事項

1. **連線 / 認證** — ...
2. **格式差異** — ...
3. **工具參數差異** — ...
4. **限制** — ...
```

**強制要求：**

- 12 個必填 `TRACKER.*` 章節**全寫**；不支援的操作章節保留，內容寫明限制與替代
- 必含「實作對應總覽」「欄位格式約束」「路線對應」「規格建卡欄位對照」四個前置表
- 文件開頭必含「分支前綴」宣告
- 寫入類章節（`addComment` / `createChildTask` / `createPullRequest` / `updatePullRequest`）必須複述「寫入前確認規則」
- 擴充操作使用系統前綴命名空間，**不可**占用 `TRACKER.*`
- 系統特有注意事項至少 4 條（連線 / 格式 / 工具參數 / 限制）

---

### Phase 5：同步 README

| 情況                  | 動作                                                    |
| ---------------------- | --------------------------------------------------------- |
| 新增 adapter 類型     | 更新 README「Adapter 文件清單」與「Adapter 選擇規則」表 |
| 補齊既有 adapter 內容 | 若 README 與新文件不一致才更新                          |

寫回 `.claude/reference/adapters/README.md`。

---

### Phase 4.6：安全可加性編輯（直接套用）

以下屬機械式、可加性（additive）編輯，風險低，在 Phase 6 展示後隨其他產物一併寫入，不需要額外的確認輪：

1. **`.mcp.json`**：若此 tracker 需要新 MCP server 且尚未註冊 → 新增一筆
2. **`.claude/settings.json`**：若此 adapter 引入新的「會建立 PR」形狀的工具呼叫 → 在 `permissions.ask` 補一筆
3. **分支命名參數化提案**：依 Phase 2.10 蒐集的分支前綴，提案（不靜默寫入，在 Phase 6 一併展示）`.claude/rules/sdd-workflow.md`「Branch Naming」與 `.claude/reference/adapters/README.md`「`TRACKER.ensureBranch`」章節的參數化編輯（若尚未參數化）

---

### Phase 6：寫入前展示與確認

整理完成後展示：

- 新 adapter 文件完整內容
- README 預計變更段落（若有）
- Phase 4.6 的安全可加性編輯 diff（`.mcp.json` / `settings.json` / 分支命名參數化）

```
即將寫入：
- <新 adapter 路徑>
- .claude/reference/adapters/README.md（若需）
- .mcp.json / .claude/settings.json 的可加性編輯（若適用）
- .claude/rules/sdd-workflow.md / adapters/README.md 的分支命名參數化（若尚未做，且提案已展示）

請確認內容無誤後輸入「確認」；若需調整請說明修改項，調整後再寫入。
```

收到「確認」/「ok」/「yes」後執行寫入。

---

### Phase 7：回報

```
## Adapter 建立結果
- adapter-id: <id>
- 系統: <name>
- 分支前綴: <PREFIX>
- 文件: <路徑>
- README: 已更新 / 無需更新

## 必填操作覆蓋
- 全部 12 個皆已實作 / 有限制（列出哪些 + 替代方案）

## 規格建卡欄位對照
- 支援頂層規格建卡 / 僅支援子任務

## 擴充操作
- <SYSTEM>.<extOp>：<用途>（無 → 「無」）

## 路線映射
- <type A> → 需求路線
- <type B> → 缺陷路線

## 已自動套用的安全可加性編輯
- <.mcp.json / settings.json / 分支命名參數化，逐項列出，無則寫「無」>

## 下一步
- 於 `.claude/rules/sdd-workflow.md` 改 `- **Tracker Adapter: <id>**` 一行切換
- 可開始執行 spex-\* skill（互動式）
```

---

## Red Flags

- ❌ 沒先讀 `.claude/reference/adapters/README.md`
- ❌ 12 個必填 `TRACKER.*` 章節缺任一
- ❌ 不支援的必填操作直接刪章節而非標限制
- ❌ skills 內新增系統專屬判斷而非寫進 adapter
- ❌ 沒寫「實作對應總覽」「欄位格式約束」「路線對應」「規格建卡欄位對照」四表任一
- ❌ 文件開頭缺「分支前綴」宣告
- ❌ 寫入類操作章節缺「寫入前確認規則」
- ❌ 擴充操作未用系統前綴命名空間（占用 `TRACKER.*`）
- ❌ README 與 adapter 文件不一致
- ❌ 複製 ADO / local-file 專屬文字到新 adapter
- ❌ 多檔 adapter 平鋪在 `adapters/` 根目錄（應開子目錄）
- ❌ 系統特有注意事項少於 4 條

## Verification

- [ ] 已讀 `.claude/reference/adapters/README.md`
- [ ] Phase 2 全部 12 子節資訊已蒐齊
- [ ] 文件含「實作對應總覽」「欄位格式約束」「路線對應」「規格建卡欄位對照」四表
- [ ] 文件開頭含「分支前綴」宣告
- [ ] 12 個必填 `TRACKER.*` 章節全寫
- [ ] 寫入類操作章節含「寫入前確認規則」
- [ ] 擴充操作（若有）使用系統前綴命名空間
- [ ] 系統特有注意事項 ≥ 4 條
- [ ] 檔案擺放符合單檔 / 多檔規則
- [ ] README「Adapter 文件清單」已更新
- [ ] Phase 6 已展示、收到「確認」後寫入

## Next Steps

✅ Adapter 已建立 → 於 `.claude/rules/sdd-workflow.md` 改 `- **Tracker Adapter: <id>**` 一行切換 → 可開始執行 spex-\* skill（互動式）。
