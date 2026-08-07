import path from 'node:path';
import prompts from 'prompts';
import { listInstallers, getInstaller } from '../installers/base.js';
import {
  loadSkillsFromAssets,
  loadReferencesFromAssets,
  loadRulesFromAssets,
  loadSubagentsFromAssets,
  getSkillDescription,
} from '../transformers/parse-skill.js';
import { getAssetsDir } from '../utils/paths.js';
import { log } from '../utils/logger.js';
import {
  installVSCodeExtensions,
  installNpmDevDeps,
  copyTemplateFile,
} from '../utils/setup-dev-tools.js';

const PLAYWRIGHT_VSCODE_EXTENSIONS = ['ms-playwright.playwright'];
const PLAYWRIGHT_NPM_DEV_DEPS = [
  '@playwright/test',
  '@nuxt/test-utils',
  'playwright-core',
];

// 確保所有 installer 都被註冊（side-effect import）
import '../installers/claude-code.js';
import '../installers/github-copilot.js';
import '../installers/codex.js';

export interface InitOptions {
  agent?: string;
  cwd: string;
  force: boolean;
  yes: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const assetsDir = getAssetsDir();
  const allSkills = await loadSkillsFromAssets(assetsDir);
  const allReferences = await loadReferencesFromAssets(assetsDir);
  const allRules = await loadRulesFromAssets(assetsDir);
  const allSubagents = await loadSubagentsFromAssets(assetsDir);

  if (allSkills.length === 0) {
    log.error('找不到任何 skills，請先執行 `npm run sync-assets`。');
    process.exit(1);
  }

  // 1. 選 agent
  let agentId = opts.agent;
  if (!agentId) {
    const installers = listInstallers();
    const detected: { id: string; displayName: string; recommended: boolean }[] = [];
    for (const inst of installers) {
      const ok = await inst.detect(opts.cwd);
      detected.push({
        id: inst.id,
        displayName: inst.displayName,
        recommended: ok,
      });
    }

    if (opts.yes) {
      const rec = detected.find((d) => d.recommended) ?? detected[0];
      agentId = rec.id;
      log.info(`使用 agent：${rec.displayName}`);
    } else {
      const ans = await prompts({
        type: 'select',
        name: 'agent',
        message: '要為哪個 AI 代理安裝 spex？',
        choices: detected.map((d) => ({
          title: d.displayName + (d.recommended ? ' (偵測到)' : ''),
          value: d.id,
        })),
      });
      if (!ans.agent) {
        log.warn('已取消');
        return;
      }
      agentId = ans.agent;
    }
  }

  const installer = getInstaller(agentId!);
  if (!installer) {
    log.error(`未知的 agent: ${agentId}`);
    process.exit(1);
  }

  // 2. 選 skills
  let skillsToInstall = allSkills;
  if (!opts.yes) {
    const ans = await prompts({
      type: 'multiselect',
      name: 'skills',
      message: '選擇要安裝的 skills（空白鍵切換，Enter 確認）',
      choices: allSkills.map((s) => ({
        title: s.name,
        description: getSkillDescription(s).split('\n')[0].slice(0, 80),
        value: s.name,
        selected: true,
      })),
      hint: '- 預設全選',
      instructions: false,
    });
    if (!ans.skills || ans.skills.length === 0) {
      log.warn('未選擇任何 skill，已取消');
      return;
    }
    skillsToInstall = allSkills.filter((s) => ans.skills.includes(s.name));
  }

  // 3. 執行安裝
  log.step(`開始安裝到 ${installer.displayName} (${opts.cwd})`);
  await installer.install({
    cwd: opts.cwd,
    skills: skillsToInstall,
    references: allReferences,
    rules: allRules,
    subagents: allSubagents,
    force: opts.force,
    log: log.dim,
  });

  log.success(`安裝完成（${skillsToInstall.length} 個 skills、${allRules.length} 個 rules）`);

  // 4. （選用）安裝 Playwright 相關開發工具（VS Code 擴充 + npm devDependencies）
  // Playwright 只是預設規則 rules/testing.md 所採用的 E2E 工具之一；
  // 測試工具由各專案的 rules/testing.md 決定，故此步驟為選用且預設不裝。
  // 非互動模式（-y）直接跳過，不安裝（與 initial:false 一致）。
  let installPlaywright = false;
  if (!opts.yes) {
    const ans = await prompts({
      type: 'confirm',
      name: 'ok',
      message:
        '（選用）安裝 Playwright 開發工具？僅在本專案以 Playwright 作 E2E 時需要（VS Code 擴充 ms-playwright.playwright，與 @playwright/test / @nuxt/test-utils / playwright-core）',
      initial: false,
    });
    installPlaywright = !!ans.ok;
  }

  if (installPlaywright) {
    log.step('安裝 Playwright 開發工具');
    await installVSCodeExtensions({
      extensions: PLAYWRIGHT_VSCODE_EXTENSIONS,
      log: log.dim,
      warn: log.warn,
    });
    await installNpmDevDeps({
      cwd: opts.cwd,
      packages: PLAYWRIGHT_NPM_DEV_DEPS,
      log: log.dim,
      warn: log.warn,
    });

    log.dim('  複製 playwright.config.ts 範本到專案根目錄');
    const result = await copyTemplateFile({
      templatePath: path.join(getAssetsDir(), 'templates', 'playwright.config.ts'),
      destPath: path.join(opts.cwd, 'playwright.config.ts'),
      force: opts.force,
      log: log.dim,
      warn: log.warn,
    });

    printPlaywrightConfigGuide(result === 'skipped');
  }

  log.info('');
  log.info('下一步：執行 `spex mcp setup` 設定 MCP server 與環境變數');
}

function printPlaywrightConfigGuide(skipped: boolean): void {
  log.info('');
  if (skipped) {
    log.warn('playwright.config.ts 已存在 — 未覆寫。請自行確認下列內容已符合你的專案：');
  } else {
    log.step('請依專案調整 playwright.config.ts');
  }
  log.info('');
  log.dim('  ▸ 必改（範本內建的是 Nuxt 專案設定，請依實際框架調整）：');
  log.info('      testDir       — E2E 測試資料夾，預設 ./tests/e2e');
  log.info('      testMatch     — 測試檔命名規則，預設 **/*.e2e.ts');
  log.info('      use.nuxt      — 非 Nuxt 專案請整段移除，並移除 @nuxt/test-utils 相依');
  log.info('      NUXT_E2E_HOST — 環境變數名稱，可改成你慣用的（例：APP_E2E_HOST）');
  log.info('');
  log.dim('  ▸ 建議補上（Playwright 常用但目前範本未列）：');
  log.info('      timeout / expect.timeout    — 測試與斷言逾時');
  log.info('      retries: process.env.CI ? 2 : 0  — CI 失敗重試');
  log.info('      workers / fullyParallel     — 平行度');
  log.info('      forbidOnly: !!process.env.CI — CI 禁止 .only 殘留');
  log.info('      reporter: [["html"], ["list"]] — 測試報告');
  log.info('      use.baseURL                 — page.goto("/") 用');
  log.info('      use.trace: "on-first-retry" — 失敗時錄 trace 方便 debug');
  log.info('      use.screenshot / use.video  — 失敗時截圖 / 錄影');
  log.info('      use.viewport                — 視窗大小');
  log.info('      projects                    — 多瀏覽器（chromium/firefox/webkit）');
  log.info('      webServer                   — 自動啟動 dev server（Nuxt 可搭配 nuxt dev）');
  log.info('      outputDir                   — 測試輸出資料夾');
  log.info('');
}
