---
name: spex-stamp
description: 章戳鏈驗章器（確定性防偽閘）。在寫留言／開卡、階段交棒、開 PR 前稽核任何 challenge / verifier 的 PASS 宣稱：對事件流（沙盒影子流或 hook 帳本）執行 challenge-audit.py，無章、章面不符、輪次超限、內容綁定不符、一章重用一律擋下。前置：challenge / verifier 已派發並留下事件紀錄。後續：回呼叫流程（task / implement / selfcheck / pull-request / schedule）。
---

# Spex: Stamp — 章戳鏈驗章器

**唯一職責：以程式碼裁定「PASS 宣稱是否有真章」，是非分明、不需 LLM 思考判斷。** 規範原文見 `.claude/rules/sdd-workflow.md`「章戳鏈（蓋章 / 驗章）」。

## 信任模型（為何無法仿冒）

| 元件     | 實體                                                            | 不可仿冒性質                                       |
| -------- | --------------------------------------------------------------- | -------------------------------------------------- |
| 蓋章者   | `challenger` / `verifier` agent（詰問完成後輸出末行章面）       | 全新上下文、唯讀；章面格式見 `.claude/agents/challenger.md` |
| 章號     | Agent 派發事件的 `tool_use_id`（`toolu_…`）或回傳的 `agentId`   | harness 生成，執行模型無法鑄造、天然不重複         |
| 章的載體 | 事件流（見下方「章源」）——一律位於**目標 repo 之外**            | 執行者寫不到（沙盒）／受 harness 與 deny 保護（hook 帳本） |
| 內容綁定 | 章面 `sha256`（NFC→空白摺疊→trim→sha256 前 16 hex）             | 舊章蓋不了改過的內容（防重放）                     |
| 消耗帳   | 一章一用（audit S6 + 呼叫方記帳）                               | 用過的章不能再支持第二個宣稱                       |

## When to Use

- ✅ 寫入任何含 `challenge：PASS` 宣稱的留言前（`spex-task` / `spex-implement` 交棒前）
- ✅ `spex-selfcheck` 寫 Verify 留言前（驗收章）
- ✅ `spex-pull-request` 開 PR 前、`spex-schedule` 對帳時的最終稽核
- ❌ 用本 skill 取代 `spex-challenge`（驗章不產生章；蓋章永遠來自 challenger / verifier 詰問）

## Process

### Phase 1: 工具與來源防竄改前置

```
git status --porcelain .claude/reference/spex/scripts
```

驗章器本身（`challenge-audit.py` / `transcript-to-stream.mjs`）有非預期的本地變更 → **停止**：稽核工具被動過等於稽核結果不可信，本輪全部產物不信任，呈報後重來。沙盒平面另有一層保險：驗章跑的是 `$SHADOW_DIR/tools/` 的 host-only 快照，不是掛載區內的檔案。

### Phase 2: 定位章源

| 平面 | 章源 | 驗章器 |
|---|---|---|
| 沙盒（`sandbox/dispatch.sh` 派工） | 影子流：`${DISPATCH_SHADOW_DIR:-~/.sandbox-shadow/<repo>}/<stem>.result.md`（`dispatch-watchdog-host.sh` 即時 tee，沙盒物理不可寫） | `$SHADOW_DIR/tools/challenge-audit.py`（host-only 快照） |
| 非沙盒（Claude Code） | 本 session transcript `~/.claude/projects/<slug>/<sessionId>.jsonl` ＋ 子代理事件 `<sessionId>/subagents/agent-<agentId>.jsonl`（皆由 harness 寫入、位於 repo 之外；歸屬記於 `agent-<agentId>.meta.json` 的 `agentType` / `toolUseId`） | `.claude/reference/spex/scripts/challenge-audit.py`，事件流先經 `transcript-to-stream.mjs` 正規化 |
| 非沙盒（Codex / Copilot） | **無事件流可驗** | — |

**Claude Code 平面的正規化步驟**（transcript 與影子流形狀不同，audit 只認後者）：

```
node .claude/reference/spex/scripts/transcript-to-stream.mjs <transcript.jsonl> > <stream.ndjson>
```

轉換器只做形狀對映（把子代理事件併回主流並補上 `subagent_type` / `parent_tool_use_id`，把 tracker 寫入的 MCP 呼叫合成等價的 `[TRACKER-ACTION]` 區塊），**不做任何判定**。

**鐵則**：

- 沙盒平面正式驗章**不得**以 `sandbox/tasks/` 掛載區鏡像替代（沙盒可竄改）。找不到影子流 → 以 `--legacy` 補稽核並明標「僅供人工複核」，不得當硬證據放行。
- Claude Code 平面另有 **PreToolUse 章戳硬閘**（`spex-stamp-guard.sh`，spex 安裝時寫入 `.claude/settings.json`）：含章戳宣稱的 tracker 寫入未過驗章一律 exit 2 拒發，且 `~/.claude/projects/` 不得被 Write / Edit / Bash 改寫。這層由 harness 執行、模型停不掉——本 skill 是它的規範面與人工稽核面。移除該 hook 屬有意識的防護降級，須在當次任務鏈留痕。
- Codex / Copilot 無 hook 與事件流，**沒有可驗的章**——此時 `spex-challenge` 仍應執行（詰問本身有價值），但交棒憑證只有 `task-draft-lint` 的確定性結果；必須在留言誠實標註「本環境無章可驗」，不得宣稱驗章通過。

### Phase 3: 執行驗章

```
python3 <驗章器路徑> <章源檔...>            # strict（預設）
python3 <驗章器路徑> --legacy <舊流>        # 無影子流的歷史紀錄補稽核
```

跨 resume 的多段事件流可一次帶多個檔（依派工先後順序），腳本會合併判定。

不變式（S0–S8、I3 的定義與由來見 `.claude/rules/sdd-workflow.md`「章戳鏈（蓋章 / 驗章）」）：

| 代號 | 檢核 |
|---|---|
| S0 | 首次 challenger 派發前流中須有載入 `spex-challenge` 的事件（憑記憶土製閘門無判準、無上限、無蓋章素材） |
| S1 | 宣稱必須引章號；章號存在於流中、屬 challenger 派發且已完成於宣稱之前 |
| S2 | 章面 verdict=PASS 且以結構化標記呈現（無標記 = 無 verdict = FAIL）；另查 stage 收斂（最新章 verdict≠PASS → 整流 block） |
| S3 | 章面 round == 宣稱輪次，且 ≤ 上限（單一來源：sdd-workflow「詰問輪次上限」行） |
| S4 | 同 stage 的章總數 ≤ 上限（超限即該接點已應升級人工） |
| S5 | 內容綁定：章面 sha256 == 正規化後的留言草稿（去除宣稱行）雜湊 |
| S6 | 一章一用：同一章號不得支持兩個內容綁定皆通過的宣稱 |
| S7 | Verify 留言必須引 verifier 章且該章 verdict=PASS |
| S8 | 章面含 sha256 時，該子代理執行軌跡內必須有真實雜湊計算的工具呼叫（否則＝憑空編造章面） |
| I3 | challenger / verifier 一律同步派發（`run_in_background` 缺省或 false） |

### Phase 4: 路由

| 結果    | 動作 |
| ------- | ---- |
| exit 0  | 放行：回呼叫流程續行；`<stem>.challenge-audit.json` 附入稽核紀錄 |
| exit ≠0 | **擋下**：不得寫留言 / 不得開卡 / 不得交棒 / 不得開 PR；記違規（不變式編號、章號、宣稱位置）→ 產物作廢、該階段重來或升級人工；**不得先行後補** |

品質指標（不擋件但必記錄）：每章的子代理 `tool_uses`——平均 <8 視為橡皮章訊號，於報告標注。

## Red Flags

- ❌ 拿掛載區鏡像當驗章來源（＝驗了執行者可竄改的東西）
- ❌ exit≠0 仍轉發、或以「宣稱看起來合理」人工改判（驗章結果不可被 LLM 覆寫）
- ❌ 用 `--legacy` 結果當硬證據放行新流
- ❌ 跳過 Phase 1 防竄改檢查直接跑稽核腳本
- ❌ 在無事件流的環境宣稱「驗章通過」

## Verification

- [ ] 驗章來源為影子流或 hook 帳本（或已明標 legacy／無章可驗）
- [ ] exit code 已記錄；exit≠0 時產物未被寫入且已記帳
- [ ] audit JSON 已保留（章號消耗帳可追溯）
