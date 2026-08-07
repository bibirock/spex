# Relay 協定（沙盒平面的 tracker 寫入通道）

> 本檔是 `[TRACKER-ACTION]` 區塊格式與**驗章硬閘接線契約**的單一來源。
> `spex-relay-init` 依本檔引導生成專案自己的 relay 執行檔；skill 引用本檔，不重述格式。

---

## 什麼時候需要 relay

| 平面 | tracker 寫入方式 | 驗章硬閘落在哪 |
|---|---|---|
| **非沙盒**（預設） | skill 直接呼叫 MCP（`TRACKER.*`） | Claude Code 的 PreToolUse hook（`spex-stamp-guard.sh`） |
| **沙盒**（`spex-sandbox-init` 生成、零憑證） | 沙盒**寫不到** tracker，只能吐 `[TRACKER-ACTION]` 區塊，由 host 端 relay 代執行 | relay 執行檔自身（本檔的接線契約） |

沙盒平面的核心限制：容器沒有 PAT／MCP，也連不出去。所以「決定要寫什麼」在沙盒、「實際寫入」在 host——中間這段就是 relay。

---

## `[TRACKER-ACTION]` 區塊格式

沙盒內的 skill 把每個 tracker 寫入意圖輸出成一個區塊：

```
[TRACKER-ACTION op=<操作> <屬性>=<值> ...]
<body>
[/TRACKER-ACTION]
```

支援的 `op` 與其 body 結構：

| op | 屬性 | body |
|---|---|---|
| `createChildTask` | `key=T-XXX` | `### TITLE` / `### DESCRIPTION` / `### ACCEPTANCE_CRITERIA` 三節 |
| `linkDependency` | `predecessor=T-XXX` `successor=T-YYY` | 無 |
| `addComment` | `id=<卡片 id>` | 留言 Markdown 全文 |
| `updateTaskState` | `id=<id 或 T-XXX>` `state=<狀態>` | 無 |

**`{{id:T-XXX}}` 占位符**：開卡前無法得知真實 ID，凡需引用尚未建立的子卡一律寫 `{{id:T-XXX}}`；relay 於 `createChildTask` 回讀真實 ID 後統一替換。**禁止**由模型推測 ID（見 `sdd-workflow.md`「ID 事實鐵則」）。

**問答接線**：沙盒內若有需人工回答的疑點，另輸出 `[ASK-USER stage=<s> qid=<Q-n>]` 與 `[CONTEXT-GAP stage=<s>]` 區塊；relay 解析後**逐字原文**轉呈使用者，答覆逐字落檔後回填續行。host / AI **不得代答、不得改寫、不得略題**（代答＝造假）。

---

## 鐵則

1. **逐字中繼**：ACTION 內容不加工、不改寫、不代答、不摘要。唯一允許的變換是 `{{id:T-XXX}}` 占位符替換。
2. **ID 事實鐵則**：真實 ID 一律由建卡 API 回傳讀回，禁止推斷；`T-XXX → 真實 ID` 映射表須留存。
3. **欄位走 adapter 規範**：開卡欄位（`workItemType`、繼承的 `iterationPath` / `assignedTo`、標題格式）以 `.claude/reference/adapters/<id>.md` 為準，relay 不得自行發明欄位值。
4. **內容間接引用要還原**：沙盒可能把大內容落檔、區塊只放引用；relay 須讀回該檔取得完整內容，**引用檔缺失 → 回派沙盒補產物，不得腦補**。

---

## 驗章硬閘接線契約（relay 執行檔必須實作）

> 目的：把「驗章 → 才能寫入」從協定紀律焦進工具層，讓「忘了驗章就 relay」物理跑不起來。

relay 的 `comment` / `relay` 路徑在**送出前**必須：

1. **偵測章戳宣稱**：留言內容含 `challenge：PASS（…章 <章號>）` 或 `驗收章 <章號>` 即進入驗章路徑；無宣稱的留言（plan 留言、批次分支留言）免驗放行。
2. **強制驗章**：對該次派工的**影子流**（不是掛載區鏡像）執行

   ```
   python3 <SHADOW_DIR>/tools/challenge-audit.py <影子流檔...>
   ```

   並確認**留言引用的章號落在該次稽核的已驗清單內**。
3. **未過即拒發**：audit 非零 exit、或引章不在已驗清單 → **以非零 exit 拒絕送出**（建議 exit 3 與一般 API 失敗區分），不得先發後補。
4. **降級留痕**：拿掉這道閘、或改以掛載區鏡像充當影子流，都屬有意識的防護降級，須在當次任務鏈留痕。

不變式定義（S0–S8、I3）見 `.claude/rules/sdd-workflow.md`「章戳鏈（蓋章 / 驗章）」；relay 只負責「呼叫並尊重 exit code」，**不得自行實作判定邏輯**（判定單一來源＝`challenge-audit.py`）。

---

## 已知限制

- 各 tracker 的內容格式不同（ADO 的 description / AC 欄位是 HTML，GitHub / Jira 各異）。Markdown → 目標格式的轉換屬 **adapter 專屬**，須在 relay 執行檔內處理並於 profile 文件揭露，不可假設所有 tracker 都吃同一種格式。
- relay 持有真實憑證，是整條鏈上權限最高的元件：只實作本檔列出的操作，**不得**擴充成通用 API 代理（那等於重新打開繞過 MCP 的管道，見 `sdd-workflow.md`「MCP-only」）。
