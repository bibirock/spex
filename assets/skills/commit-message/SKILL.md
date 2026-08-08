---
name: commit-message
description: >
  依循 Conventional Commits 1.0.0-beta.4 規範，以繁體中文撰寫 Git commit 訊息，並附上異動檔案列表。

  當使用者要求「寫 commit」、「產生 commit message」、「幫我 commit」、「產生提交說明」、「整理這次的改動」，或提供了 git
  diff / 異動檔案清單，請立即使用本 skill。

  也適用於使用者請求 code review 後需要整理提交說明，或詢問「這次改了什麼要怎麼寫 commit」等情境。
---

# Conventional Commit 繁體中文 Skill

## 目標

依 Conventional Commits 1.0.0-beta.4，以**繁體中文**產生 commit 訊息，footer 列出異動檔案。

---

## Adapter 引用（取得 ID）

commit 的 tracker item ID **一律由現行 adapter 取得，不在本 skill 內寫死 `ADO-`、數字格式或分支樣式**（最大化通用性，隨 adapter 抽換）。注意：ID 放在**類型後的括號內**（`type(ID):`）；scope 是模組名，放在冒號後的 `[方括號]` 內，兩者不可互換。

依 [Skills 引用 Adapter 規範](../../reference/adapters/README.md#skills-引用-adapter-規範) 用**章節索引**只讀現行 adapter 的對應章節，**禁止整檔載入**：

| 取用        | 協定章節（anchor）                                                                     | 用途                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID 格式樣式 | [`TRACKER.ensureBranch`](../../reference/adapters/README.md#trackerensurebranchparams) | 取得該 adapter 的 ID 格式（純值樣式）。**commit 的 ID 用「當前執行的子卡 Task id」，不是從分支名解析出的父卡 id**（分支解析僅供確認在對的父卡分支） |

讀取 SOP（同 adapters/README「Agent 讀取 SOP」）：

1. 由 `.claude/rules/sdd-workflow.md` 的 `Tracker Adapter:` 取得現行 adapter，對照 adapters/README「Adapter 選擇規則」找到 adapter 檔路徑。
2. `grep -n "^## .TRACKER\.ensureBranch" <adapter-file>` → 起始行；`grep -n "^## " <adapter-file>` 找下一個 `## ` → 結束行。
3. `Read(file, offset=<起始>, limit=<結束-起始>)` 只讀該段，取得「組分支名」格式。
4. 以**當前正在實作的子卡 Task ID**（Phase 3 執行中的 T-XXX 對應 childId）作為 commit 的 tracker item ID；**不是**父卡 id、**不是**從分支名 `.../<TRACKER_PREFIX>-<父id>-...` 解析出的父 id。

> ID 格式因 adapter 而異（見 adapters/README「ID 格式說明」）；本 skill 不假設為數字。
> ⛔ **ID 必須由 tracker 即時讀回**（readItem / fetch 子卡），**禁止**依建卡順序、前一張卡編號 +1、或分支名推斷——自動編號會被其他資料或已刪項目占號，推斷必錯。

---

## 結構

```
<類型>[(<ID>)]: [scope] <繁體中文描述>

[本文]

[footer]
```

| 欄位         | 必填 | 規則                                                                                                    |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------- |
| 類型         | ✅   | 英文小寫（見下表）                                                                                      |
| 範疇（模組） | ❌   | 模組 / 區域名，英文小寫（如 `auth`、`user-profile`），放冒號後 `[方括號]` 內；**不是** tracker ID |
| 描述         | ✅   | 繁中、重點開頭、精簡一行、不加句號；可含關鍵指標（如 `27s→~22ms`）                                      |
| ID           | ❌   | 置於類型後括號內 `type(ID):`（純值，無 `ADO-`/`#` 前綴）；來源見上方 Adapter 引用                       |
| 本文         | ❌   | 繁中，與描述空一行                                                                                      |
| Footer       | ❌   | 含 `異動檔案:` 區塊                                                                                     |

> 範例（你目前的格式）：`perf(1234): [tree-view] 改自繪 O(n) 分層佈局取代遞迴渲染，大型清單展開 27s→~22ms`

---

## 類型

| 類型       | 用途               | SemVer |
| ---------- | ------------------ | ------ |
| `feat`     | 新增功能           | MINOR  |
| `fix`      | 修復錯誤           | PATCH  |
| `docs`     | 僅文件變更         | —      |
| `style`    | 格式 / 空白 / 分號 | —      |
| `refactor` | 重構               | —      |
| `perf`     | 效能 / 優化        | —      |
| `test`     | 測試異動           | —      |
| `adjust`   | 工具 / 設定 / 雜項 | —      |
| `ci`       | CI / CD / 建置     | —      |
| `revert`   | 回復先前 commit    | —      |

---

## 異動檔案 Footer 格式

```
異動檔案:
- <操作> 路徑/檔案
```

操作標籤：`新增` / `修改` / `刪除` / `重新命名`（重新命名標 `舊名 → 新名`）

---

## 範例

**SDD 任務（ADO ID + [scope]）：**

```
perf(12345): [tree-view] 改自繪 O(n) 分層佈局取代遞迴渲染，大型清單展開 27s→~22ms

異動檔案:
- 修改 <UI 層>/tree/TreeView.<ext>
```

**功能或者一般修改（feat）：**

```
feat(user-profile): 新增頭像收合面板切換

實作基於使用者偏好的收合狀態保存。

異動檔案:
- 修改 <UI 層>/user/ProfilePanel.<ext>
- 修改 <狀態管理層>/user.<ext>
```

---

## 流程

1. **判斷 scope（模組）**：取主要異動所屬模組 / 區域名作 scope（英文小寫，如 `auth`），置於冒號後 `[方括號]` 內；跨多模組或不明顯 → 省略。
2. **取 ID**：用**當前正在實作的子卡 Task id**（Phase 3 執行中的 T-XXX 對應 childId），置於類型後括號內 `type(ID):`（純值）。`ensureBranch` 章節僅用來確認 ID 格式樣式與在對的父卡分支；**不要**拿 `git branch --show-current` 解析出的父 id 當 commit ID，也**不要**從既有 git log 反推。無子卡 / 非 SDD → 省略。
3. **蒐集異動**：解析 `git diff` 或檔案清單；無法判斷類型時詢問。
4. **判類型**：依改動主要目的；跨多個不相關目的建議拆分。
5. **寫描述**：繁中重點開頭、精簡一行、不加句號；可含關鍵指標（如 `27s→~22ms`）。
6. **本文**：原因不明顯或涉及決策才寫。
7. **Footer**：列檔案；若有 Issue → `關聯 Issue: #<號碼>`。
8. **輸出**：code block 完整訊息；有歧義時提供 1–2 個替代版本。

---

## 規則

- 類型與範疇（模組）用英文小寫；描述、本文、footer 說明繁中
- ID 與分支樣式不在本 skill 寫死 → 一律走「Adapter 引用」取得（最大化通用性）
- 描述不加句號；可含關鍵指標（如效能前後對比）
- 本文 / footer 之間皆空一行
- 跨多個不相關目的 → 建議拆分 commit
- `perf` 涵蓋效能與優化（不用 `improvement`）
- 雜項用 `adjust`（不用 `chore`）
