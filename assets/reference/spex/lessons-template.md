# 教訓檔範本（lessons-learned 格式單一來源）

> 本範本由 spex 安裝，是 SDD「教訓回收與升級」閉環的**格式單一來源**：
> `spex-implement` / `spex-selfcheck` / `spex-schedule` 在 Fail 或被使用者糾正時依本範本**捕捉（Capture）**教訓；各 SDD skill 啟動時依本範本格式**取回（Recall）**相關教訓。
> 教訓檔落地於目標專案的 `.claude/lessons/`（Copilot：`.spex/lessons/`；Codex：`.codex/lessons/`）。

## 為什麼存在

AI 工作流最大的可靠度缺口不是「會犯錯」，而是**同一類錯誤反覆犯**——每次失敗的教訓隨對話 / 卡片留言消散，下一輪從零開始。教訓檔把失敗變成**跟著 repo 走、可被取回、可被升級為硬防護**的持久記憶，補上「捕捉 → 萃取 → 取回 → 升級 → 修剪」閉環。

## 落地位置與鐵則

- 目錄 `.claude/lessons/`——**必須 commit、禁止寫進 `.gitignore`**（教訓要跨輪、跨人、跨工具共享，不能綁在某台機器的個人記憶層）。
- 一教訓一檔 `L-<seq>.md`（seq 為 4 位零補，如 `L-0007.md`）＋ 一份索引 `INDEX.md`。
- 目錄為 **on-demand**：首次要寫教訓時才 `mkdir -p .claude/lessons/`，不由 installer 預建。
- 教訓檔 frontmatter 的 `skills:` 沿用既有 scope 機制——**取回只在相關 skill 的脈絡發生**，不污染無關工作。

## 教訓檔格式（`L-<seq>.md`）

```markdown
---
id: L-0007
skills: [spex-implement, spex-selfcheck]   # 此教訓在哪些 skill 的脈絡該被取回
trigger: selfcheck-fail        # selfcheck-fail | implement-f4 | human-feedback
status: active                 # active | promoted | retired
recurrence: 2                  # 同類教訓累計命中次數（Distill 時 +1）
firstSeen: 2026-06-21          # 首次捕捉日期（YYYY-MM-DD）
lastSeen: 2026-06-21           # 最近一次命中日期
---

## 症狀
<可觀察的失敗現象：哪個驗證 / AC / 測試怎麼掛的，貼最小可辨識證據>

## 根因
<root cause：為什麼會這樣，一句話講清楚>

## 防護
<下次具體怎麼避免：一條「該 skill 執行時能做的」檢查或動作（可被 grep / 測試 / 檢核項落實的）>

## 升級狀態
<未升級 / selfcheck 防錯檢核第 N 項 / sdd-workflow.md 歷史教訓 / 迴歸測試 path:line>
```

欄位說明：

| 欄位 | 規則 |
|---|---|
| `id` | `L-<4 位序號>`，與檔名一致；序號取 `INDEX.md` 現有最大值 +1。 |
| `skills` | 此教訓所屬 skill（tool-neutral 名，如 `spex-implement`）；決定 Recall 時哪個 skill 會讀到它。 |
| `trigger` | 捕捉來源：`selfcheck-fail`（selfcheck Phase 4 Fail）／`implement-f4`（implement F.4 Fail）／`human-feedback`（被使用者糾正）。 |
| `status` | `active`（生效中）／`promoted`（已升級為硬防護，仍保留供溯源）／`retired`（引用的檔 / 旗標已不存在，退役）。 |
| `recurrence` | 同症狀＋根因再次出現時 +1；`≥ 2` 是 Promote 門檻。 |
| `firstSeen` / `lastSeen` | 日期；`lastSeen` 每次命中更新。日期一律由使用者 / 環境提供，skill 不臆造。 |

## 索引格式（`INDEX.md`）

供 Capture 去重比對與 Recall 快速勾稽；每教訓一列，依 `id` 遞增。

```markdown
# Lessons Index

| id | skills | trigger | status | recurrence | lastSeen | 症狀摘要 |
|----|--------|---------|--------|------------|----------|---------|
| L-0007 | implement, selfcheck | selfcheck-fail | active | 2 | 2026-06-21 | In-Scope 邊界項漏驗仍判 PASS |
```

## 五步閉環（接到 SDD 流程的接點）

| 步驟 | 做什麼 | 接點 |
|---|---|---|
| **Capture 捕捉** | Fail / 被糾正時，依上方格式萃取一則結構化教訓 | selfcheck Phase 4 Fail、implement F.4 Fail、schedule 互動確認被糾正 |
| **Distill 萃取/去重** | 寫入前 grep `INDEX.md` 比對症狀＋根因；命中 → `recurrence+1`、更新 `lastSeen`；否則新建 `L-<seq>.md` 並補一列索引 | 同 Capture 接點 |
| **Recall 取回** | 各 SDD skill 啟動「規則載入」前導段，多一步 grep `.claude/lessons/INDEX.md` 取 `skills:` 命中本 skill 的 `active` 教訓，讀其「防護」 | 各 SDD skill 前導段 |
| **Promote 升級** | `recurrence ≥ 2` → 由 skill **主編排者**（非獨立驗證者）提案升級為確定性硬防護（防錯檢核項／`sdd-workflow.md` 歷史教訓／迴歸測試），人工確認後寫入並標 `status: promoted` | selfcheck 主編排者 |
| **Prune 修剪** | Recall 時若教訓「防護 / 升級狀態」引用的檔 / 旗標已不存在 → 標 `status: retired`，不再注入 | 各 SDD skill 前導段 |

> 詳見 `.claude/rules/sdd-workflow.md` 的 `## 教訓回收與升級` 章節（治理單一來源）。
> **鐵則**：獨立驗證者只讀證據、不背 Capture / Promote 職責（守住「驗證者不改 code」）；`TRACKER.createPullRequest` 仍只在 pull-request。
