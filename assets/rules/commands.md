---
skills:
  - spex-plan
  - spex-task
  - spex-implement
  - spex-selfcheck
---

# Commands 規則

> 本檔是可編輯的**專案規則**，由 spex 安裝。spex 系列 skill 引用「驗證指令」時以本檔為唯一來源；請依專案的 `package.json` scripts 調整。
> 本檔以 frontmatter 的 `skills:` 宣告**所屬的 skill**，由 spex 安裝時依各工具 scope：Claude Code 把 `skills:` 轉成 `.claude/rules/` 的 `paths:`（指向各 skill 的 `SKILL.md`）、Copilot 轉成 `.github/instructions/` 的 `applyTo:`（指向各 skill 的 `.prompt.md`）、Codex 以 HTML 註解標示（無自動 scope，由 skill 執行時讀取）。如此本規則只在這些 skill 的脈絡相關，不污染使用者的無關工作。調整所屬 skill 只要改本清單。

```bash
## TODO: 填入專案相關 command，供 SDD 流程引用
```

**Repo 根目錄絕對路徑：** `## TODO: [本 repo 絕對路徑；多 repo 任務時所有指令一律以此為錨（git -C / npm --prefix / cd && ...同一呼叫內），防 cd 殘留跑錯目錄]`

**驗證指令束（SDD 流程引用）：** `## TODO: [你所定義的驗證流程，上方的 bash 指令驗證組合]`

**唯讀驗證指令束（selfcheck / 獨立驗證者 / CI 引用）：** `## TODO: [同上但不可有寫入副作用——lint 不帶 --fix、不帶 --cache（--cache 會遮蔽既有錯誤、--fix 使獨立驗證者無法在唯讀約束下重跑）]`

> E2E / UI 驗證的測試工具與指令見 [testing.md](./testing.md)。
