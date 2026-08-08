import path from 'node:path';
import prompts from 'prompts';
import { listInstallers, getInstaller, type InstallMode } from '../installers/base.js';
import { applyInstallMode } from '../transformers/install-mode.js';
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
  /** 安裝版本；未指定則互動式詢問（`-y` 時預設 agent） */
  mode?: InstallMode;
  cwd: string;
  force: boolean;
  yes: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const assetsDir = getAssetsDir();
  const loadedSkills = await loadSkillsFromAssets(assetsDir);
  const loadedReferences = await loadReferencesFromAssets(assetsDir);
  const loadedRules = await loadRulesFromAssets(assetsDir);
  const loadedSubagents = await loadSubagentsFromAssets(assetsDir);

  if (loadedSkills.length === 0) {
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

  // 1.5 選安裝版本（章戳鏈的平面）。預設 agent——沙盒版 host 與沙盒兩端各是一個 AI，
  // 兩邊都得完整理解需求並來回溝通，token 開銷 2 倍以上，只在需要嚴格隔離執行環境時才划算。
  const mode = await resolveMode(opts);

  // 依版本過濾資產、剝除沙盒專屬段落，讓 installer 保持模式無關
  const { skills: allSkills, references, rules, subagents } = applyInstallMode(mode, {
    skills: loadedSkills,
    references: loadedReferences,
    rules: loadedRules,
    subagents: loadedSubagents,
  });

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
  log.step(`開始安裝到 ${installer.displayName} (${opts.cwd})，版本：${MODE_LABEL[mode]}`);
  await installer.install({
    cwd: opts.cwd,
    mode,
    skills: skillsToInstall,
    references,
    rules,
    subagents,
    force: opts.force,
    log: log.dim,
  });

  log.success(`安裝完成（${skillsToInstall.length} 個 skills、${rules.length} 個 rules）`);
  printModeSummary(mode, installer.id);

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

const MODE_LABEL: Record<InstallMode, string> = {
  agent: 'agent（無沙盒）',
  sandbox: 'sandbox（Docker 沙盒）',
};

/** 決定安裝版本：`--mode` / `--sandbox` 指定優先，其次互動式詢問，`-y` 一律 agent。 */
async function resolveMode(opts: InitOptions): Promise<InstallMode> {
  if (opts.mode) return opts.mode;
  if (opts.yes) {
    log.info(`使用安裝版本：${MODE_LABEL.agent}`);
    return 'agent';
  }

  const ans = await prompts({
    type: 'select',
    name: 'mode',
    message: '要安裝哪一種版本？',
    choices: [
      {
        title: 'agent — 無沙盒（推薦，一般情況用這個）',
        description: '驗章走 Agent 子代理 + PreToolUse 硬閘；寫碼與驗證在同一份原始碼樹',
        value: 'agent',
      },
      {
        // 成本寫進 title 而非只放 description——prompts 只顯示「當前游標項」的 description，
        // 放在 description 會讓使用者選到才看見「貴 2 倍」，等於沒有提前警示。
        title: 'sandbox — Docker 沙盒（token 開銷 2 倍以上）',
        description:
          'host 與沙盒兩端 AI 各自理解需求並來回溝通，故開銷加倍；僅在執行程式碼須嚴格限制環境（零憑證、封 egress）時使用',
        value: 'sandbox',
      },
    ],
    initial: 0,
  });
  // 使用者中途 Ctrl+C → 取消整個安裝，不要靜默落到預設值
  if (!ans.mode) {
    log.warn('已取消');
    process.exit(0);
  }
  return ans.mode as InstallMode;
}

/** 印出本次安裝的平面資訊與後續步驟（沙盒版還要提醒第二支 hook 的手動合併）。 */
function printModeSummary(mode: InstallMode, agentId: string): void {
  const isClaude = agentId === 'claude-code';
  log.info('');
  if (mode === 'agent') {
    log.dim('  安裝版本：agent（無沙盒）— 未安裝沙盒協定與 relay 文件');
    if (isClaude) {
      log.dim('  章戳硬閘：PreToolUse hook（--plane agent），章源為本 session 事件流');
    }
    return;
  }

  log.dim('  安裝版本：sandbox（Docker 沙盒）— 已安裝沙盒協定、樣板與 relay 文件');
  if (isClaude) {
    log.dim('  章戳硬閘：驗章由 relay 執行檔裁定；PreToolUse hook 轉為 --plane sandbox，');
    log.dim('            只擋「host 直接以 MCP 發出含章留言」，不再拿 transcript 驗章');
  }
  log.info('');
  log.dim('  下一步（沙盒版）：');
  log.info('    1. 執行 /spex-sandbox-init 生成實際沙盒檔案');
  log.info('    2. 依 .claude/settings.sandbox-snippet.json 手動合併 sandbox-guard.sh hook');
  log.warn('       兩支 PreToolUse hook 並存，合併時「只增不換」——勿覆蓋 spex 既有的章戳硬閘條目');
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
