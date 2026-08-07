---
name: spex-relay-init
description: 建立沙盒平面的 tracker 寫入通道（relay）。沙盒零憑證、寫不到 tracker，只能吐 [TRACKER-ACTION] 區塊由 host 代執行；本 skill 依 relay-protocol 引導使用者填齊該專案的 tracker API 形式與驗章接線，生成可運作的 relay 執行檔骨架。前置：已有 tracker adapter（/create-adapter）與沙盒（/spex-sandbox-init）。後續：sandbox/dispatch.sh 派工時由 host relay 代寫 tracker。
---

# Spex: Relay Init — 建立 tracker 寫入通道

## Overview

架構設計師角色，處理**tracker 寫入通道軸**——與 `create-adapter`（tracker 語意軸）、`spex-sandbox-init`（語言／技術棧軸）是三姊妹 skill。

**只有沙盒平面需要 relay**：非沙盒平面由 skill 直接呼叫 MCP，驗章硬閘落在 Claude Code 的 PreToolUse hook（`spex-stamp-guard.sh`，安裝時自動寫入），不需要本 skill。

**本 skill 不提供任何 tracker 的現成實作**——各家 API、認證方式、內容格式差異太大，寫死一份等於只服務一種 tracker。這裡引導你為自己的 tracker 生成骨架，並確保**驗章硬閘一定被接上**。

## When to Use

- ✅ 專案已生成沙盒（`sddSkillGuardEnabled` / `trackerCardInjectionGuardEnabled` 開啟）且需要 tracker 寫入
- ✅ 既有 relay 要換 tracker、或要補上漏掉的驗章硬閘
- ❌ 沒用沙盒（非沙盒平面走 MCP 直呼，不需要 relay）
- ❌ 只想新增 tracker 的讀寫語意定義（改用 `/create-adapter`）

---

## Process

### Phase 1：讀協定（強制最先）

讀 `.claude/reference/spex/relay-protocol.md`，理解 `[TRACKER-ACTION]` 區塊格式、`{{id:T-XXX}}` 占位符、四條鐵則與**驗章硬閘接線契約**。協定與需求衝突 → 先討論改協定，不要在 relay 裡另立規則。

同時讀 `.claude/reference/adapters/<目前生效的 adapter>.md`，取得該 tracker 的 12 個操作定義與欄位規範。

### Phase 2：蒐集需求（逐項問答，資訊不足不生成）

#### 2.1 執行環境

- **語言**（沙盒平面的 host 端工具語言，與專案語言無關）：Python / Node / 其他
- **檔名**：慣例為 `sandbox/<trackerAdapterId>-relay.py`（或對應副檔名）

#### 2.2 API 形式與認證

- REST / GraphQL / CLI 包裝？端點 base URL 形式？
- 認證方式（PAT / OAuth token / API key）與**環境變數名稱**
- **鐵則確認**：憑證只從環境變數讀取，**禁止**寫入專案內任何檔案（含 `.env`）；生成的 relay 不得含明文 token

#### 2.3 內容格式轉換

- 該 tracker 的 description / 留言吃什麼格式（Markdown / HTML / ADF）？
- 需不需要 Markdown → 目標格式的轉換器？若需要，一併生成並在 profile 文件揭露此限制

#### 2.4 要支援哪些 op

對照協定的四個 op（`createChildTask` / `linkDependency` / `addComment` / `updateTaskState`）逐一確認 API 對映；不支援的**不可略過章節**，須寫明限制與替代方案。

#### 2.5 驗章接線（**不可跳過**）

- 影子流路徑怎麼取得（`dispatch.sh` 的 `DISPATCH_SHADOW_DIR`，預設 `~/.sandbox-shadow/<repo>`）
- 驗章器路徑（`$SHADOW_DIR/tools/challenge-audit.py` 的 host-only 快照）
- 拒發的 exit code（建議 3，與一般 API 失敗的 1 區分）
- **確認使用者理解**：這道閘拿掉就等於回到「靠自律驗章」，是有意識的防護降級

### Phase 3：生成骨架

依 Phase 2 結果生成 relay 執行檔，**必須**包含：

1. 協定四個 op 的解析與代執行（含 `{{id:T-XXX}}` 回填）
2. `ASK-USER` / `CONTEXT-GAP` 區塊的原文抽出（供 host 轉呈使用者）
3. **驗章硬閘**：`comment` / `relay` 路徑在送出前偵測章戳宣稱 → 跑 `challenge-audit.py` → 引章須在已驗清單 → 未過非零 exit 拒發
4. 寫入後回讀核對（確認實際落地內容與送出內容一致）

**不得**：擴充成通用 API 代理、把判定邏輯自行實作一份（判定單一來源是 `challenge-audit.py`）、把憑證寫進檔案。

### Phase 4：寫入前展示與確認

展示 relay 執行檔完整內容 ＋ 影響的檔案清單 ＋ 需要使用者設定的環境變數（只列名稱與設定指令，**不代寫**）：

```
即將寫入：
- sandbox/<id>-relay.py
- （若需要）Markdown → <格式> 轉換器

需要你自行設定的環境變數（放 ~/.zshrc 或 CI Secret，spex 不會代寫）：
- <VAR_NAME>：<用途>

請確認內容無誤後輸入「確認」。
```

### Phase 5：回報與驗收指引

```
## Relay 建立結果
- 執行檔：<路徑>｜語言：<lang>｜tracker：<adapter id>
- 支援 op：<清單>｜不支援：<清單 + 替代方案>
- 驗章硬閘：已接線（拒發 exit <code>）
- 環境變數：<清單>（未設定前 relay 無法運作）

## 驗收
1. 乾跑：對一個含章戳宣稱、但章號造假的留言呼叫 relay → **必須被拒發**
2. 正常路徑：對無章宣稱的留言呼叫 relay → 應正常寫入並回讀核對通過
```

---

## Red Flags

- ❌ 生成的 relay 沒有驗章硬閘（等於白做——這是 relay 存在的主要理由之一）
- ❌ 以掛載區鏡像（`sandbox/tasks/*.result.md`）當驗章來源（沙盒可竄改）
- ❌ 憑證寫進專案檔案
- ❌ relay 自行實作 S0–S8 判定，而非呼叫 `challenge-audit.py`
- ❌ 逐字中繼被改成「摘要後寫入」
- ❌ 資訊不足仍硬生成骨架

## Verification

- [ ] 已讀 `relay-protocol.md` 與當前 adapter 文件
- [ ] Phase 2 各子節資訊齊全（不支援的 op 已寫明限制）
- [ ] 驗章硬閘已接線且拒發 exit code 已定義
- [ ] 憑證只走環境變數，專案內無明文 token
- [ ] Phase 4 已展示並取得「確認」後才寫入
- [ ] 已跑 Phase 5 的造假章驗收（必須被拒發）
