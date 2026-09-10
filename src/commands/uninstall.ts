import prompts from 'prompts';
import { listInstallers, getInstaller, type AgentInstaller } from '../installers/base.js';
import {
  loadSkillsFromAssets,
  loadReferencesFromAssets,
  loadRulesFromAssets,
  loadSubagentsFromAssets,
  loadHooksFromAssets,
} from '../transformers/parse-skill.js';
import { MCP_SERVERS } from '../mcp/servers.js';
import { getAssetsDir } from '../utils/paths.js';
import { log } from '../utils/logger.js';

// 確保所有 installer 都被註冊（side-effect import）
import '../installers/claude-code.js';
import '../installers/github-copilot.js';
import '../installers/codex.js';

export interface UninstallOptions {
  agent?: string;
  cwd: string;
  yes: boolean;
  /** 只移除指定的 skill；空陣列 = 移除整個 spex 安裝 */
  skillNames: string[];
}

export async function runUninstall(opts: UninstallOptions): Promise<void> {
  const assetsDir = getAssetsDir();
  const allSkills = await loadSkillsFromAssets(assetsDir);
  const allReferences = await loadReferencesFromAssets(assetsDir);
  const allRules = await loadRulesFromAssets(assetsDir);
  const allSubagents = await loadSubagentsFromAssets(assetsDir);
  const allHooks = await loadHooksFromAssets(assetsDir);

  // 1. 解析 agent（指定優先，否則自動偵測）
  const installer = await resolveInstaller(opts);
  if (!installer) return;

  const full = opts.skillNames.length === 0;

  // 2. partial 模式：比對要移除的 skill 名稱
  let skillsToRemove = allSkills;
  if (!full) {
    skillsToRemove = allSkills.filter((s) => opts.skillNames.includes(s.name));
    const missing = opts.skillNames.filter(
      (n) => !allSkills.find((s) => s.name === n),
    );
    if (missing.length) {
      log.error(`找不到 skills: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  // 3. 確認（破壞性操作，預設需確認；-y 跳過）
  if (!opts.yes) {
    const summary = full
      ? `將從 ${installer.displayName} 移除全部 spex 內容（skills、reference、rules、agent 文件、hooks、MCP 設定與 spex-temp）`
      : `將從 ${installer.displayName} 移除 ${skillsToRemove.length} 個 skill：${skillsToRemove.map((s) => s.name).join(', ')}`;
    log.warn(summary);
    const ans = await prompts({
      type: 'confirm',
      name: 'ok',
      message: '確定要解除安裝嗎？此操作無法復原。',
      initial: false,
    });
    if (!ans.ok) {
      log.info('已取消');
      return;
    }
  }

  // 4. 執行解除安裝
  log.step(`解除安裝（${installer.displayName}，${opts.cwd}）`);
  await installer.uninstall({
    cwd: opts.cwd,
    skills: skillsToRemove,
    references: full ? allReferences : [],
    rules: full ? allRules : [],
    subagents: full ? allSubagents : [],
    hooks: full ? allHooks : [],
    full,
    mcpServerIds: MCP_SERVERS.map((s) => s.id),
    log: log.dim,
  });

  log.success(
    full
      ? '已移除全部 spex 內容'
      : `已移除 ${skillsToRemove.length} 個 skill`,
  );
}

/** 取得目標 installer：--agent 指定優先，否則自動偵測；都失敗則報錯。 */
async function resolveInstaller(
  opts: UninstallOptions,
): Promise<AgentInstaller | undefined> {
  if (opts.agent) {
    const installer = getInstaller(opts.agent);
    if (!installer) {
      log.error(`未知的 agent: ${opts.agent}`);
      process.exit(1);
    }
    return installer;
  }

  const detected: AgentInstaller[] = [];
  for (const inst of listInstallers()) {
    if (await inst.detect(opts.cwd)) detected.push(inst);
  }

  if (detected.length === 0) {
    log.error('未偵測到任何已安裝的 agent，請用 --agent 指定');
    process.exit(1);
  }
  if (detected.length === 1) return detected[0];

  // 偵測到多個：互動式選擇（-y 模式取第一個）
  if (opts.yes) {
    log.info(`偵測到多個 agent，使用：${detected[0].displayName}`);
    return detected[0];
  }
  const ans = await prompts({
    type: 'select',
    name: 'agent',
    message: '偵測到多個 agent，要從哪個解除安裝？',
    choices: detected.map((d) => ({ title: d.displayName, value: d.id })),
  });
  if (!ans.agent) {
    log.info('已取消');
    return undefined;
  }
  return getInstaller(ans.agent);
}
