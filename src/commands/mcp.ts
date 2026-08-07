import prompts from 'prompts';
import { listInstallers, getInstaller } from '../installers/base.js';
import { MCP_SERVERS } from '../mcp/servers.js';
import { log } from '../utils/logger.js';

import '../installers/claude-code.js';
import '../installers/github-copilot.js';
import '../installers/codex.js';

export interface McpSetupOptions {
  agent?: string;
  cwd: string;
  yes: boolean;
}

export async function runMcpSetup(opts: McpSetupOptions): Promise<void> {
  // 1. 選 agent
  let agentId = opts.agent;
  if (!agentId) {
    const installers = listInstallers();
    if (opts.yes) {
      for (const inst of installers) {
        if (await inst.detect(opts.cwd)) {
          agentId = inst.id;
          break;
        }
      }
      agentId = agentId ?? installers[0].id;
    } else {
      const ans = await prompts({
        type: 'select',
        name: 'agent',
        message: '要為哪個 agent 設定 MCP？',
        choices: installers.map((i) => ({
          title: i.displayName,
          value: i.id,
        })),
      });
      if (!ans.agent) return;
      agentId = ans.agent;
    }
  }

  const installer = getInstaller(agentId!);
  if (!installer) {
    log.error(`未知 agent: ${agentId}`);
    process.exit(1);
  }

  // 2. 選 server
  let chosen = MCP_SERVERS.filter((s) => s.defaultEnabled);
  if (!opts.yes) {
    const ans = await prompts({
      type: 'multiselect',
      name: 'servers',
      message: '選擇要啟用的 MCP servers',
      choices: MCP_SERVERS.map((s) => ({
        title: `${s.id} — ${s.description}`,
        value: s.id,
        selected: !!s.defaultEnabled,
      })),
      instructions: false,
    });
    if (!ans.servers) return;
    chosen = MCP_SERVERS.filter((s) => ans.servers.includes(s.id));
  }

  // 3. 寫設定檔
  log.step(`寫入 MCP 設定到 ${installer.displayName}`);
  await installer.configureMcp({
    cwd: opts.cwd,
    servers: chosen,
    log: log.dim,
  });

  // 4. 收集需要的環境變數，引導使用者寫入 shell 設定檔
  const requiredEnv = new Map<string, { server: string; description: string; helpUrl?: string }>();
  for (const s of chosen) {
    for (const v of s.envVars ?? []) {
      requiredEnv.set(v.name, {
        server: s.id,
        description: v.description,
        helpUrl: v.helpUrl,
      });
    }
  }

  if (requiredEnv.size === 0) {
    log.success('完成（此組合不需要環境變數）');
    return;
  }

  reportShellEnv(requiredEnv, installer.id);

  log.info('');
  log.success('MCP 設定完成');
}

/** 依 agent 描述 MCP 設定檔如何讀取環境變數；三種佔位/轉發語法並不相同，訊息不可寫死單一格式。 */
function describeMcpEnvUsage(agentId: string): string {
  switch (agentId) {
    case 'claude-code':
      return '以下變數會被 .mcp.json 透過 ${VAR} 讀取。';
    case 'github-copilot':
      return '以下變數會被 .vscode/mcp.json 透過 ${env:VAR} 讀取。';
    case 'codex':
      return '以下變數會被 .codex/config.toml 轉發（stdio 用 env_vars、http 用 bearer_token_env_var；不支援 ${VAR} 內插）。';
    default:
      return '以下變數會被上方寫入的 MCP 設定檔讀取。';
  }
}

function reportShellEnv(
  required: Map<string, { server: string; description: string; helpUrl?: string }>,
  agentId: string,
): void {
  log.info('');
  log.step('環境變數設定（請手動加入 ~/.zshrc 或 ~/.bashrc）');
  log.dim(`  ${describeMcpEnvUsage(agentId)}`);
  log.dim('  ⚠ 機密 token 絕不可寫入專案內任何檔案（含 .env.local）。');
  log.info('');

  const missing: string[] = [];
  for (const [name, info] of required.entries()) {
    const exists = !!process.env[name];
    log.info(`  ${exists ? '✓' : '✗'} ${name}`);
    log.dim(`      用途: ${info.description}（server: ${info.server}）`);
    if (info.helpUrl) log.dim(`      取得: ${info.helpUrl}`);
    if (!exists) missing.push(name);
  }

  if (missing.length) {
    log.info('');
    log.warn('下列環境變數尚未設定，請執行：');
    log.info('');
    for (const name of missing) {
      console.log(`  echo 'export ${name}=<your-value>' >> ~/.zshrc`);
    }
    log.info('');
    log.dim('  完成後重啟 shell 或執行：source ~/.zshrc');
  }
}
