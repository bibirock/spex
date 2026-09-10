# Skills 資產目錄

此目錄存放所有 spex 可安裝的 skills，供 Claude Code、GitHub Copilot 與 Codex CLI 使用。

## Skills 功能總結

| Skill | 角色 | 核心職責 |
|-------|------|---------|
| **write-spec** | 需求分析師 | 角色旅程 + 邊界探索 + 列舉完整性，寫成符合 spec-template 的二元可判定規格 |
| **plan** | 技術規劃師 | 確認驗收單位、定位影響面、盤點既有測試契約、產出 AC 測試對映與工作分支 |
| **fixbug** | 資深工程師 | 根因不明的缺陷專用：症狀拆解、本地重現、可驗證假設，交付修復方向 |
| **task** | 任務分解師 | 只在有獨立切片、責任分工或持久化依賴時拆卡，每張帶 Red / Green / Refactor 與完成條件 |
| **implement** | 開發工程師 | 逐 AC TDD 與相關回歸，完成後記「Implement 完成待 Epic 驗收」 |
| **selfcheck** | 驗收編排者 | 一次整體 code review → 一次完整機器驗證 → 一次全新上下文 verifier |
| **schedule** | 批次排程者 | 共用分支逐 Story 推進，按 Epic 集中驗收與整合，支援中斷續行 |
| **create-adapter** | 架構設計師 | 建立 Tracker Adapter 文件（10 個核心操作），讓 spex 支援新追蹤系統 |
| **commit-message** | 工具 | 依 Conventional Commits 規範，用繁體中文撰寫 commit 訊息並列異動檔案 |

### SDD 流程鏈（執行順序）

```
write-spec → plan → [fixbug] → [task] → implement
                       ↑                    │
                       └──── Epic 下一張 ────┤
                                            ▼
                        全部 Story 就緒 → selfcheck → 依授權整合
```

**關鍵設計**：

- **write-spec** 是開卡前的規格源頭，In Scope / 邊界 / 列舉成員與 AC 同屬驗收範圍
- **plan** 是規格進來的第一站；Plan 夠清楚就直接 implement，不補儀式性的 task
- **fixbug** 只在根因不明時使用，提供修復方向給 plan，不寫產品程式碼
- **implement** 逐 AC 跑 focused TDD 與相關回歸，不逐卡跑全量、不逐卡派整體 review
- **Story 不各自驗收**：完成即記「Implement 完成待 Epic 驗收」，該狀態可解除後續 Story 的實作依賴
- **selfcheck** 是驗收單位的唯一收口；三道各做一次，修正後只複查 delta
- **schedule** 多卡批次，按 Epic 分組驗收與整合，每輪從 tracker 重新盤點
- **create-adapter** 靜態維護，支援多個追蹤系統

驗收單位是 Epic 與其全部納入 Story；沒有 Epic 的單卡以自身為驗收單位，走同一條路。

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
- **description** — 簡述此 skill 的目的、前置與後續，供代理判斷何時載入

## 各 Agent 的安裝位置

安裝後的位置因 agent 而異：

- **Claude Code** — `.claude/skills/<name>/SKILL.md`
- **GitHub Copilot** — `.github/prompts/<name>.prompt.md`（自動轉換格式）
- **Codex CLI** — `.codex/skills/<name>/SKILL.md`

## 跨檔引用規則

Skill body 內可引用其他資源：

- **規則檔** — 使用 `.claude/rules/<file>.md` 路徑（安裝時自動轉換為各 agent 格式）
- **Reference** — 使用相對路徑 `../../reference/<name>/`（安裝後即為該 agent 的 reference 目錄）
- **其他 Skill** — 使用 `.claude/skills/<name>/SKILL.md` 路徑（Copilot 自動轉為 `.github/prompts/<name>.prompt.md`）
- **子代理** — 以 `subagent_type` 名稱引用（`code-reviewer` / `verifier`），引用前先確認 `assets/agents/` 有對應定義

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
- **不寫死工具** — 測試框架、E2E 工具與驗證指令一律引用 `rules/testing.md` 與 `rules/commands.md`，skill 內不指定特定框架
