import {
  SPEX_SANDBOX_ONLY_REFERENCES,
  SPEX_SANDBOX_ONLY_SKILLS,
  type InstallMode,
  type ReferenceSource,
  type RuleSource,
  type SkillSource,
  type SubagentSource,
} from '../installers/base.js';

/**
 * 沙盒專屬段落的圍欄標記。被圍起來的內容只在 `sandbox` 模式落地；
 * `agent` 模式安裝時連同圍欄一起剝除，讓目標專案只看到自己這個平面的指示。
 *
 * 之所以用「一份來源 + 圍欄」而不是拆成兩份資產：章戳鏈的規範必須單一來源，
 * 分叉成兩檔遲早會漂移（其中一份的不變式被改、另一份沒跟上 = 兩個平面說法不一致）。
 */
const SANDBOX_SECTION_START = '<!-- spex:sandbox-only:start -->';
const SANDBOX_SECTION_END = '<!-- spex:sandbox-only:end -->';

/** 同一行內的 `start …… end`（表格儲存格用）——非貪婪，一行可有多組 */
const INLINE_SANDBOX_SECTION = new RegExp(
  `${escapeRegExp(SANDBOX_SECTION_START)}[\\s\\S]*?${escapeRegExp(SANDBOX_SECTION_END)}`,
  'g',
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 剝除文字中所有沙盒專屬段落（含圍欄本身），並收斂因移除而產生的連續空行。
 * 支援兩種寫法：
 * - **整行圍欄**：start / end 各自獨佔一行，中間整段（可跨多行）剝除。
 * - **行內圍欄**：start 與 end 在同一行內，只剝那一段——表格儲存格內只想拿掉半句話時用。
 *
 * 找不到圍欄時原樣回傳；只有 start 沒有對應 end 時保留原文（寧可多裝，不要截斷檔案）。
 */
export function stripSandboxSections(text: string): string {
  if (!text.includes(SANDBOX_SECTION_START)) return text;

  // 先處理行內圍欄，剩下的必然是整行圍欄，交給下面的逐行掃描
  const lines = text.replace(INLINE_SANDBOX_SECTION, '').split('\n');
  const kept: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === SANDBOX_SECTION_START) {
      depth++;
      continue;
    }
    if (trimmed === SANDBOX_SECTION_END) {
      // 沒配對的 end 視為雜訊，直接丟掉，不讓 depth 變負數
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) kept.push(line);
  }

  // start 沒收尾 → 判定圍欄壞掉，保守回傳原文（避免砍掉半份檔案）
  if (depth !== 0) return text;

  // 剝除後可能留下三行以上空白，收斂成最多一個空行
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 只拿掉圍欄標記本身，保留被圍起來的內容——`sandbox` 模式用。
 * 標記是給安裝流程看的，不該出現在落地檔裡讓 LLM 讀到（HTML 註解在渲染時看不見，
 * 但 skill / rule 是以原始文字餵進模型的）。整行圍欄連同該行一起移除，行內圍欄只去標記。
 */
export function removeSandboxMarkers(text: string): string {
  if (!text.includes(SANDBOX_SECTION_START) && !text.includes(SANDBOX_SECTION_END)) {
    return text;
  }
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return t !== SANDBOX_SECTION_START && t !== SANDBOX_SECTION_END;
    })
    .join('\n')
    .split(SANDBOX_SECTION_START)
    .join('')
    .split(SANDBOX_SECTION_END)
    .join('');
}

/** `agent` 模式濾掉沙盒專屬 skill；`sandbox` 模式原樣回傳。 */
export function filterSkillsForMode(
  skills: SkillSource[],
  mode: InstallMode,
): SkillSource[] {
  if (mode === 'sandbox') return skills;
  return skills.filter((s) => !SPEX_SANDBOX_ONLY_SKILLS.includes(s.name));
}

/** `agent` 模式濾掉沙盒專屬 reference（前綴比對）；`sandbox` 模式原樣回傳。 */
export function filterReferencesForMode(
  references: ReferenceSource[],
  mode: InstallMode,
): ReferenceSource[] {
  if (mode === 'sandbox') return references;
  return references.filter(
    (r) => !SPEX_SANDBOX_ONLY_REFERENCES.some((p) => r.relativePath.startsWith(p)),
  );
}

export interface ModeAssets {
  skills: SkillSource[];
  references: ReferenceSource[];
  rules: RuleSource[];
  subagents: SubagentSource[];
}

/**
 * 依安裝版本過濾資產並剝除沙盒專屬段落，回傳新的陣列（不變更輸入）。
 * 集中在這裡做，讓三個 installer 保持模式無關——它們只需要知道 hook 要掛哪個平面。
 *
 * skill 只剝 `body`（frontmatter 的 name / description 不套圍欄，改以平面中性措辭撰寫）；
 * rule 的 `content` 與 `body` 同時剝（圍欄只出現在 body 區，兩者等價）；
 * subagent（challenger / verifier）與平面無關，原樣保留。
 */
export function applyInstallMode(mode: InstallMode, assets: ModeAssets): ModeAssets {
  const skills = filterSkillsForMode(assets.skills, mode);
  const references = filterReferencesForMode(assets.references, mode);

  // sandbox 模式保留全部內容，但仍要把圍欄標記本身清掉（標記是安裝流程的元資料，不是內容）
  if (mode === 'sandbox') {
    return {
      skills: skills.map((s) => ({ ...s, body: removeSandboxMarkers(s.body) })),
      references: references.map((r) => ({
        ...r,
        content: removeSandboxMarkers(r.content),
      })),
      rules: assets.rules.map((r) => ({
        ...r,
        content: removeSandboxMarkers(r.content),
        body: removeSandboxMarkers(r.body),
      })),
      subagents: assets.subagents,
    };
  }

  return {
    skills: skills.map((s) => ({ ...s, body: stripSandboxSections(s.body) })),
    references: references.map((r) => ({
      ...r,
      content: stripSandboxSections(r.content),
    })),
    rules: assets.rules.map((r) => ({
      ...r,
      frontmatter: withoutSandboxSkills(r.frontmatter),
      content: stripSandboxSections(r.content),
      body: stripSandboxSections(r.body),
    })),
    subagents: assets.subagents,
  };
}

/**
 * 從 rule frontmatter 的 `skills:` 清單移除沙盒專屬 skill。
 * 各 installer 由這份清單推導 scope（Claude `paths:` / Copilot `applyTo:`），
 * agent 模式下那些 skill 根本沒安裝，留著只會產生指向不存在檔案的 glob。
 */
function withoutSandboxSkills(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const raw = frontmatter.skills;
  if (!Array.isArray(raw)) return frontmatter;
  const kept = raw.filter(
    (s) => !(typeof s === 'string' && SPEX_SANDBOX_ONLY_SKILLS.includes(s.trim())),
  );
  if (kept.length === raw.length) return frontmatter;
  return { ...frontmatter, skills: kept };
}
