import matter from 'gray-matter';
import { getRuleSkills, type SkillSource, type RuleSource } from '../installers/base.js';
import { getSkillDescription } from './parse-skill.js';

/**
 * 將 Claude Code 的 SKILL.md 轉成 GitHub Copilot 的 .prompt.md 格式。
 *
 * Copilot prompts 規範（VS Code GitHub Copilot Chat）：
 *   ---
 *   mode: 'agent'   # 或 'ask' / 'edit'
 *   description: '...'
 *   tools: ['terminal', 'codebase']
 *   ---
 *   prompt 內文（支援 ${input:name} 與 ${file} 等變數）
 *
 * 注意：Copilot prompt 是「手動」觸發（聊天視窗 /<filename>），
 * 不像 Claude Code 的 SKILL.md 會根據 description 自動判斷啟用，
 * 因此會在內文頂部加註提示，引導使用者主動呼叫。
 */
export function toCopilotPrompt(skill: SkillSource): string {
  const description = rewriteClaudePaths(getSkillDescription(skill));

  const copilotFrontmatter = {
    mode: 'agent' as const,
    description: description || `${skill.name} skill`,
    // 預設給 agent 模式可用的工具（使用者可在 VS Code 端調整）
    tools: ['codebase', 'terminal', 'editFiles', 'search'],
  };

  const header = matter.stringify('', copilotFrontmatter).trim();

  const notice = [
    '<!--',
    '  此 prompt 由 spex-cli 從 Claude Code SKILL.md 自動轉換而來。',
    '  在 VS Code 的 Copilot Chat 視窗輸入 `/' + skill.name + '` 即可手動觸發。',
    '  原始 SKILL.md（含自動觸發語意）建議搭配 Claude Code 使用以取得最佳體驗。',
    '-->',
  ].join('\n');

  return `${header}\n\n${notice}\n\n${rewriteClaudePaths(skill.body.trim())}\n`;
}

/**
 * 把 skill 內文中 Claude Code 慣例的 .claude/ 路徑改寫成 Copilot 的安裝位置。
 * Claude Code 把 reference / rules 裝在 .claude/ 下，Copilot 則裝在專案根的 .spex/，
 * 因此 prompt 內文要求 Read 的路徑必須對應 Copilot 的實際落地位置。
 * skill 之間的跨檔引用（body 內出現其他 skill 的 SKILL.md 路徑）則改指對應的 prompt 檔。
 */
function rewriteClaudePaths(body: string): string {
  return body
    .replace(/\.claude\/skills\/([^/]+)\/SKILL\.md/g, '.github/prompts/$1.prompt.md')
    .replace(/\.claude\/reference\//g, '.spex/reference/')
    .replace(/\.claude\/rules\//g, '.spex/rules/')
    .replace(/\.claude\/lessons\//g, '.spex/lessons/');
}

/** 從 rule 的相對路徑取出名稱（去副檔名），例如 "testing.md" → "testing"。 */
function ruleName(rule: RuleSource): string {
  return rule.relativePath.replace(/\.md$/i, '');
}

/**
 * 把 rule 的 `skills:` 宣告轉成 Copilot `.instructions.md` 的 `applyTo:` 逗號分隔
 * glob 字串，指向各 skill 對應的 prompt 檔（`.github/prompts/<name>.prompt.md`）。
 * 無有效 skills 回傳 undefined。
 */
export function skillsToApplyTo(skills: string[]): string | undefined {
  const globs = skills.map((name) => `.github/prompts/${name}.prompt.md`);
  return globs.length > 0 ? globs.join(',') : undefined;
}

/**
 * 由帶 `skills:` 的 rule 產生 Copilot `.github/instructions/<name>.instructions.md`
 * 指標檔內容：以 `applyTo:` 把規則 scope 到對應 skill 的 prompt 檔，內文指向實際規則檔
 * `.spex/rules/<name>.md`（規則內容單一來源，避免雙處漂移）。
 * rule 無 `skills:` 時回傳 undefined（不產生 instruction 檔，維持只靠 prompt runtime 讀）。
 */
export function toCopilotInstruction(rule: RuleSource): string | undefined {
  const applyTo = skillsToApplyTo(getRuleSkills(rule.frontmatter));
  if (!applyTo) return undefined;

  const name = ruleName(rule);
  const header = matter
    .stringify('', {
      applyTo,
      description: `spex 專案規則：${name}`,
    })
    .trim();

  const body = [
    '<!-- 由 spex-cli 產生；對應 rule 的 skills: 宣告，scope 到各 skill 的 prompt 檔。 -->',
    `使用上述 \`applyTo\` 指向的 prompt（skill）時，請遵循專案規則 \`.spex/rules/${name}.md\`。`,
  ].join('\n');

  return `${header}\n\n${body}\n`;
}

/**
 * 產生 .github/copilot-instructions.md — 提供 Copilot 全域引導，
 * 讓它知道有哪些可用的 prompts 並理解專案規範。
 */
export function buildCopilotInstructions(skills: SkillSource[]): string {
  const skillList = skills
    .map((s) => `- \`/${s.name}\` — ${getSkillDescription(s).split('\n')[0]}`)
    .join('\n');

  return `# Copilot 全域指引

此檔案由 \`spex-cli\` 產生，提供 GitHub Copilot 全域上下文。

## 專案規範

- 所有註解、文件、UI 文字使用**繁體中文**
- 程式識別字（function、variable、type）保持英文
- TypeScript strict mode；避免 \`any\`
- Commit message 遵循 Conventional Commits（type(scope): description）

## 可用 Prompts

以下 prompts 已安裝在 \`.github/prompts/\`，在 Copilot Chat 輸入 \`/<name>\` 觸發：

${skillList}

## 專案規則（Rules）

專案規則（adapter、驗證指令、測試 / E2E 工具、Code Conventions、架構與 File Zone）位於 \`.spex/rules/\`。
prompt 執行時會主動讀取對應規則檔（例如 \`.spex/rules/testing.md\` 決定測試 / E2E 工具）。
**不需要**手動把這些設定寫進其他檔案，安裝即生效；換工具或調整慣例只要編輯對應的規則檔。

另外 \`.github/instructions/<name>.instructions.md\` 以 \`applyTo:\` glob 把規則 **scope 到對應的 prompt（skill）**（對應 rule 的 \`skills:\` 宣告）：指向各 skill 的 \`.github/prompts/<name>.prompt.md\`，引導使用該 prompt 時遵循對應的 \`.spex/rules/\` 規則。如此規則只在這些 skill 的脈絡相關，不污染其他工作。調整所屬 skill 改規則檔的 \`skills:\`；規則內容仍只在 \`.spex/rules/\` 編輯。

## 參考資料

專案規格與適配器文件位於 \`.spex/reference/\`，相關 prompt 會引用其中內容。

## MCP 連線

如已設定 MCP（\`.vscode/mcp.json\`），可在 Copilot Chat 使用 azure-devops、github、stackoverflow 等工具呼叫。
`;
}
