# Skills 資產目錄

此目錄存放所有 spex 可安裝的 skills，供 Claude Code、GitHub Copilot 與 Codex CLI 使用。

## Skills 功能總結

| Skill | 角色 | 核心職責 |
|-------|------|---------|
| **write-spec** | 需求分析師 | 透過問答與邊界探索，把模糊想法寫成符合 spec-template 的結構化規格 |
| **plan** | 技術規劃師 | 讀規格做分類（需求/缺陷、Tier），建工作分支，產生技術實施計畫 |
| **fixbug** | 資深工程師 | 缺陷 M/L 規模專用，深入分析根因，查第三方套件議題與用法，提供修復方向 |
| **task** | 任務分解師 | 垂直切片、定義 TDD 驗收標準，拆成可執行的任務清單，寫入依賴連結；開卡前必經 lint + 對抗式詰問取章 |
| **challenge** | 對抗式詰問者 | task / implement 交棒前派全新上下文 challenger 詰問 C1–C6，PASS 才蓋章；FAIL 產修正清單退回 |
| **stamp** | 驗章器 | 以 `challenge-audit.py` 對事件流裁定「PASS 宣稱是否有真章」，exit ≠ 0 一律擋下交棒 |
| **implement** | 開發工程師 | 依序執行 TDD（Red → Green → Refactor），同步 tracker，全流程驗證，交棒 selfcheck |
| **selfcheck** | 獨立驗收者 | 跑確定性檢查 + E2E，派 `verifier` 逐條 AC 對照 diff（防錯檢核 A–G），PASS/FAIL 二元判定並驗章 |
| **pull-request** | PR 守門員 | PR 開立唯一入口，確認 selfcheck 通過，組裝 PR，寫稽核留言，流程閉環 |
| **schedule** | 批次排程者 | 多卡片逐一依序套用完整 SDD workflow，保證終態唯一性與不遺漏 |
| **create-adapter** | 架構設計師 | 建立 Tracker Adapter 文件，讓 spex 支援新追蹤系統（GitHub / Jira / Linear / ADO） |
| **relay-init** | 架構設計師 | 沙盒平面專用：引導生成該專案的 tracker 寫入通道（relay）並接上驗章硬閘 |
| **commit-message** | 工具 | 依 Conventional Commits 規範，用繁體中文撰寫 commit 訊息並列異動檔案 |

### SDD 流程鏈（執行順序）

```
write-spec → plan → [fixbug (M/L)] → [task (Tier 2)] → 
implement → selfcheck → pull-request → [schedule (批次)] → 人類 review
```

**關鍵設計**：
- **write-spec** 是開卡前的規格源頭
- **plan** 是 spec 進來的第一站，負責分類與技術規劃
- **fixbug** 只作用於缺陷 M/L，提供修復方向給 plan
- **task** 僅用於 Tier 2 細化；Tier 1 由 plan 直接開單張卡
- **implement** 唯一負責編寫代碼，不開 PR
- **selfcheck** 獨立驗收，失敗最多重做 2 輪再升級人工
- **pull-request** 全流程唯一開 PR 點，確保不遺漏驗證
- **schedule** 多卡批次排程，每輪重新盤點，保證終態唯一
- **create-adapter** 靜態維護，支援多個追蹤系統

## 目錄結構

```
assets/skills/
├── <skill-name>/
│   └── SKILL.md          # skill 定義與內容
├── CLAUDE.md             # 本檔
└── ...
```

## 新增 Skill

1. 在本目錄建立 `<skill-name>/` 資料夾
2. 在該資料夾內新增 `SKILL.md`，包含 frontmatter 與 body：

```markdown
---
name: <skill-name>
description: <one-line 描述，用於決定相關性>
metadata:
  type: <skill type>
---

<skill 內容>
```

3. 重新建置專案：

```bash
npm run build
```

4. Commit `SKILL.md` 與相關資源

## Skill Frontmatter 欄位

- **name** — skill 的唯一識別符（英數加 hyphen，例如 `spex-implement`）
- **description** — 單行簡述，說明此 skill 的目的
- **metadata.type** — skill 類型（例如 `sdd`、`utility`、`reference`）

## 各 Agent 的安裝位置

安裝後的位置因 agent 而異：

- **Claude Code** — `.claude/skills/<name>/SKILL.md`
- **GitHub Copilot** — `.github/prompts/<name>.prompt.md`（自動轉換格式）
- **Codex CLI** — `.codex/skills/<name>/SKILL.md`

## 跨檔引用規則

Skill body 內可引用其他資源：

- **規則檔** — 使用 `.claude/rules/<file>.md` 路徑（安裝時自動轉換為各 agent 格式）
- **Reference** — 使用 `.claude/reference/<name>/` 路徑
- **其他 Skill** — 使用 `.claude/skills/<name>/SKILL.md` 路徑（Copilot 自動轉為 `.github/prompts/<name>.prompt.md`）

## 同步上游資產

若需從上游 repo 更新 skills 資產：

```bash
SOURCE_REPO=/path/to/upstream node scripts/sync-assets.mjs
```

**注意**：此指令會整資料夾覆蓋，本地編輯會遺失。執行前請備份或同步變更回上游。

## 維護原則

- **一份來源** — `assets/skills/` 是唯一真實來源，各 agent 安裝時動態轉換
- **格式無關** — skill body 採 Markdown，安裝時轉換為各 agent 的原生格式
- **Scope 清晰** — 使用規則檔 frontmatter 的 `skills:` 欄位限制規則生效範圍
