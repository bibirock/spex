import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  SkillSource,
  ReferenceSource,
  RuleSource,
  SubagentSource,
  HookSource,
} from '../installers/base.js';

/** 從 assets/skills/ 載入所有 skill */
export async function loadSkillsFromAssets(assetsDir: string): Promise<SkillSource[]> {
  const skillsDir = path.join(assetsDir, 'skills');
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  const skills: SkillSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    const exists = await fs
      .access(skillFile)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;

    const raw = await fs.readFile(skillFile, 'utf8');
    const parsed = matter(raw);
    skills.push({
      name: entry.name,
      frontmatter: parsed.data,
      body: parsed.content,
      sourcePath: skillFile,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** 從 assets/reference/ 載入所有 reference 檔（遞迴） */
export async function loadReferencesFromAssets(
  assetsDir: string,
): Promise<ReferenceSource[]> {
  const referenceDir = path.join(assetsDir, 'reference');
  const results: ReferenceSource[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(full, 'utf8');
        results.push({ relativePath: rel, content });
      }
    }
  }

  const exists = await fs
    .access(referenceDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];

  await walk(referenceDir, '');
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** 從 assets/rules/ 載入所有 rule 檔（遞迴） */
export async function loadRulesFromAssets(
  assetsDir: string,
): Promise<RuleSource[]> {
  const rulesDir = path.join(assetsDir, 'rules');
  const results: RuleSource[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const raw = await fs.readFile(full, 'utf8');
        // 以 gray-matter 解析 rule frontmatter（沿用 loadSkillsFromAssets 模式）。
        // 無 frontmatter 的檔案會回傳 data: {}、content: 原文，安全。
        const parsed = matter(raw);
        results.push({
          relativePath: rel,
          content: raw,
          frontmatter: parsed.data,
          body: parsed.content,
        });
      }
    }
  }

  const exists = await fs
    .access(rulesDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];

  await walk(rulesDir, '');
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** 從 assets/agents/ 載入所有 subagent 定義（code-reviewer / verifier，只取頂層 .md） */
export async function loadSubagentsFromAssets(
  assetsDir: string,
): Promise<SubagentSource[]> {
  const agentsDir = path.join(assetsDir, 'agents');
  const exists = await fs
    .access(agentsDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];

  const entries = await fs.readdir(agentsDir, { withFileTypes: true });
  const results: SubagentSource[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const raw = await fs.readFile(path.join(agentsDir, entry.name), 'utf8');
    const parsed = matter(raw);
    const declared = parsed.data.name;
    results.push({
      name:
        typeof declared === 'string' && declared.trim()
          ? declared.trim()
          : entry.name.replace(/\.md$/, ''),
      relativePath: entry.name,
      content: raw,
    });
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * 從 assets/hooks/ 載入編輯期 hook 資產（只取頂層檔案）。
 * `.env` 結尾者視為專案自行維護的設定檔，安裝時不覆寫既有內容。
 */
export async function loadHooksFromAssets(assetsDir: string): Promise<HookSource[]> {
  const hooksDir = path.join(assetsDir, 'hooks');
  const exists = await fs
    .access(hooksDir)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];

  const entries = await fs.readdir(hooksDir, { withFileTypes: true });
  const results: HookSource[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const content = await fs.readFile(path.join(hooksDir, entry.name), 'utf8');
    results.push({
      relativePath: entry.name,
      content,
      isConfig: entry.name.endsWith('.env'),
    });
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** 從 frontmatter 取得 description（支援多行 YAML pipe 格式） */
export function getSkillDescription(skill: SkillSource): string {
  const raw = skill.frontmatter.description;
  if (typeof raw === 'string') return raw.trim();
  return '';
}
