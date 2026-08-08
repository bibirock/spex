import { Command } from 'commander';
import { createRequire } from 'node:module';
import process from 'node:process';
import { runInit } from './commands/init.js';
import { runUninstall } from './commands/uninstall.js';
import { runMcpSetup } from './commands/mcp.js';
import { printBanner } from './utils/banner.js';

const loadPackageJson = createRequire(import.meta.url);
const { version: VERSION } = loadPackageJson('../package.json') as { version: string };

// banner 在所有指令前印一次；若使用者只想看版本號則略過
const isVersionQuery = process.argv.slice(2).some((a) => a === '-V' || a === '--version');
if (!isVersionQuery) {
  printBanner(VERSION);
}

const program = new Command();

program
  .name('spex')
  .description('將 spex skills 與 MCP 設定安裝到 Claude Code / GitHub Copilot / Codex')
  .version(VERSION);

program
  .command('init')
  .description('初始化：安裝 skills、reference、temp 到當前專案')
  .option('--agent <id>', '指定 agent：claude-code | github-copilot | codex（不指定則互動式選擇）')
  .option(
    '--mode <mode>',
    '安裝版本：agent（預設，無沙盒）| sandbox（Docker 沙盒，token 開銷 2 倍以上）',
  )
  .option('--sandbox', '等同 --mode sandbox', false)
  .option('--cwd <path>', '目標專案根目錄', process.cwd())
  .option('--force', '覆寫已存在的檔案', false)
  .option('-y, --yes', '跳過互動式提問，使用預設選項', false)
  .action(async (opts) => {
    // --sandbox 是 --mode sandbox 的語法糖；兩者同時給且互相矛盾時視為使用者手誤，直接報錯。
    if (opts.sandbox && opts.mode && opts.mode !== 'sandbox') {
      console.error(`--sandbox 與 --mode ${opts.mode} 衝突，請擇一`);
      process.exit(1);
    }
    const mode = opts.sandbox ? 'sandbox' : opts.mode;
    if (mode !== undefined && mode !== 'agent' && mode !== 'sandbox') {
      console.error(`未知的安裝版本：${mode}（僅支援 agent | sandbox）`);
      process.exit(1);
    }

    await runInit({
      agent: opts.agent,
      mode,
      cwd: opts.cwd,
      force: opts.force,
      yes: opts.yes,
    });
  });

program
  .command('uninstall [skills...]')
  .description('解除安裝：移除寫進專案的 spex 內容（不帶 skill 名稱則移除全部）')
  .option('--agent <id>', '指定 agent（不指定則自動偵測）')
  .option('--cwd <path>', '目標專案根目錄', process.cwd())
  .option('-y, --yes', '跳過確認提問', false)
  .addHelpText(
    'after',
    '\n注意：本指令清的是「寫進專案的資產」（.claude/、.github/、.codex/、.mcp.json、spex-temp/ 等），\n' +
      '不是 CLI 本身。要移除 CLI 程式，請另外執行 `npm uninstall -g spex-cli`\n' +
      '（npm uninstall 只清 node_modules，不會碰這些散在專案各處的資產）。',
  )
  .action(async (skills: string[], opts) => {
    await runUninstall({
      agent: opts.agent,
      cwd: opts.cwd,
      yes: opts.yes,
      skillNames: skills ?? [],
    });
  });

program
  .command('mcp')
  .description('設定 MCP servers')
  .argument('[action]', '預設 setup', 'setup')
  .option('--agent <id>', '指定 agent')
  .option('--cwd <path>', '目標專案根目錄', process.cwd())
  .option('-y, --yes', '跳過互動式提問', false)
  .action(async (action: string, opts) => {
    if (action !== 'setup') {
      console.error(`未知動作：${action}（目前僅支援 setup）`);
      process.exit(1);
    }
    await runMcpSetup({
      agent: opts.agent,
      cwd: opts.cwd,
      yes: opts.yes,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
