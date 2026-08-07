import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function execCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; inherit?: boolean } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (!opts.inherit) {
      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
    }
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function commandExists(cmd: string): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const res = await execCommand(which, [cmd]);
  return res.code === 0;
}

export interface InstallVSCodeExtensionsOptions {
  extensions: string[];
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function installVSCodeExtensions(
  opts: InstallVSCodeExtensionsOptions,
): Promise<void> {
  const { extensions, log, warn } = opts;
  if (extensions.length === 0) return;

  const hasCode = await commandExists('code');
  if (!hasCode) {
    warn(
      '找不到 `code` CLI，略過 VS Code 擴充安裝。請於 VS Code 內執行 "Shell Command: Install \'code\' command in PATH" 後重試。',
    );
    return;
  }

  for (const ext of extensions) {
    log(`  安裝 VS Code 擴充: ${ext}`);
    const res = await execCommand('code', ['--install-extension', ext, '--force']);
    if (res.code !== 0) {
      warn(`  擴充安裝失敗 (${ext}): ${res.stderr.trim() || res.stdout.trim()}`);
    }
  }
}

export interface CopyTemplateOptions {
  /** 模板來源絕對路徑（位於 CLI 套件內 assets/templates/）*/
  templatePath: string;
  /** 目標檔絕對路徑 */
  destPath: string;
  force: boolean;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function copyTemplateFile(
  opts: CopyTemplateOptions,
): Promise<'written' | 'skipped' | 'missing'> {
  const { templatePath, destPath, force, log, warn } = opts;

  const templateRaw = await fs.readFile(templatePath, 'utf8').catch(() => null);
  if (templateRaw == null) {
    warn(`找不到模板：${templatePath}（請執行 npm run sync-assets）`);
    return 'missing';
  }

  const exists = await fs
    .access(destPath)
    .then(() => true)
    .catch(() => false);

  if (exists && !force) {
    log(`  跳過（已存在，使用 --force 可覆寫）: ${destPath}`);
    return 'skipped';
  }

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, templateRaw, 'utf8');
  log(`  ${exists ? '覆寫' : '寫入'}: ${destPath}`);
  return 'written';
}

export interface InstallNpmDevDepsOptions {
  cwd: string;
  packages: string[];
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function installNpmDevDeps(
  opts: InstallNpmDevDepsOptions,
): Promise<void> {
  const { cwd, packages, log, warn } = opts;
  if (packages.length === 0) return;

  const pkgPath = path.join(cwd, 'package.json');
  const pkgRaw = await fs.readFile(pkgPath, 'utf8').catch(() => null);
  if (!pkgRaw) {
    warn(`找不到 ${pkgPath}，略過 npm 套件安裝。`);
    return;
  }

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    warn(`${pkgPath} 不是合法 JSON，略過 npm 套件安裝。`);
    return;
  }

  const existing = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const toInstall = packages.filter((p) => !existing.has(p));
  const skipped = packages.filter((p) => existing.has(p));

  for (const p of skipped) {
    log(`  跳過（已在 package.json）: ${p}`);
  }

  if (toInstall.length === 0) return;

  const hasNpm = await commandExists('npm');
  if (!hasNpm) {
    warn('找不到 `npm` CLI，略過套件安裝。請手動執行：npm i -D ' + toInstall.join(' '));
    return;
  }

  log(`  執行: npm i -D ${toInstall.join(' ')}`);
  const res = await execCommand('npm', ['i', '-D', ...toInstall], {
    cwd,
    inherit: true,
  });
  if (res.code !== 0) {
    warn(`npm 安裝失敗（exit ${res.code}），請手動執行：npm i -D ${toInstall.join(' ')}`);
  }
}
