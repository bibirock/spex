#!/usr/bin/env node
// Sandbox Profile 渲染器（零依賴，見 .claude/reference/sandboxes/README.md 的樣板替換機制）。
// 用法：
//   node render-profile.mjs --profile <profile.json> --templates <dir> --out <target-root> [--dry-run] [--check]
// --out 是目標「repo 根目錄」，不是 sandbox/ 子目錄——templates/ 底下的檔案以「repo 根為基準」的
// 相對路徑組織（templates/sandbox/Dockerfile.tmpl → <repo根>/sandbox/Dockerfile、
// templates/.devcontainer/devcontainer.json.tmpl → <repo根>/.devcontainer/devcontainer.json，以此類推），
// 渲染器單純鏡射這個目錄結構，不做任何「這個檔案該放哪裡」的特判。
// --dry-run：只印出將寫入的檔案清單 + 既有檔案的差異摘要，不寫檔。
// --check：對 --out 底下已渲染的檔案重跑 YAML/JSON 語法驗證 + 殘留 token 掃描，不重新渲染。
//
// 樣板語法：
//   {{TOKEN_NAME}}                 直接值代換
//   {{#IF flagName}} ... {{/IF}}   單層區塊條件（flagName 為 truthy 才保留區塊內容），不支援巢狀
//
// 設計原則（見 README.md「樣板替換機制」）：{{...}} 在 bash/Dockerfile 是惰性字面文字，未代換會讓
// 建置直接失敗（fail-fast）；YAML 值必須加引號以避免被誤判成 flow-mapping，本腳本對 .yml/.yaml
// 輸出額外掃描「未加引號的 {{ 值」；最終斷言輸出樹裡不得殘留任何 {{ token。
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join, relative, dirname, extname, sep } from 'node:path';

function parseArgs(argv) {
  const out = { dryRun: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--profile') out.profile = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--check') out.check = true;
  }
  return out;
}

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else results.push(full);
  }
  return results;
}

// ── Profile → tokens 推導 ────────────────────────────────────────────────
function bashArrayLiteral(items, indent = '  ') {
  return items.map((d) => `${indent}${d}`).join('\n');
}

function joinCommands(bundle) {
  return bundle.map((s) => s.command).join(' && ');
}

function renderSidecarComposeBlock(services) {
  if (!services || services.length === 0) return '';
  return services
    .map((svc) => {
      const envLines = Object.entries(svc.environment || {})
        .map(([k, v]) => `      ${k}: ${v}`)
        .join('\n');
      const hc = svc.healthcheck || {};
      return [
        `  ${svc.name}:`,
        `    image: ${svc.image}`,
        `    environment:`,
        envLines,
        `    healthcheck:`,
        `      test: ['CMD-SHELL', '${hc.test}']`,
        `      interval: ${hc.interval || '5s'}`,
        `      timeout: ${hc.timeout || '3s'}`,
        `      retries: ${hc.retries ?? 10}`,
        // 資料目錄路徑因映像而異（postgres:/var/lib/postgresql/data、mysql:/var/lib/mysql、
        // mongo:/data/db…），不可從 service name 猜測——必須由 profile 作者在 volumeMountPath
        // 明確宣告（見該映像的官方文件），渲染器不對任何特定資料庫做假設。
        svc.volumeName && svc.volumeMountPath
          ? `    volumes:\n      - ${svc.volumeName}:${svc.volumeMountPath}`
          : '',
        `    networks:`,
        `      - sandboxnet`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function renderDependsOnBlock(services) {
  if (!services || services.length === 0) return '';
  return services
    .map((s) => `      ${s.name}:\n        condition: service_healthy`)
    .join('\n');
}

function renderVolumeMounts(depsCacheVolumes) {
  return depsCacheVolumes
    .map((v) => `      - ${v.volumeName}:${v.containerPath}`)
    .join('\n');
}

function renderTopLevelVolumes(
  depsCacheVolumes,
  sidecarServices,
  additionalDispatchTargets,
) {
  const names = new Set();
  for (const v of depsCacheVolumes || []) names.add(v.volumeName);
  for (const s of sidecarServices || [])
    if (s.volumeName) names.add(s.volumeName);
  for (const t of additionalDispatchTargets || [])
    for (const v of t.depsCacheVolumes || []) names.add(v.volumeName);
  names.add('claude_config');
  return [...names].map((n) => `  ${n}:`).join('\n');
}

// 每個 sidecar 可選宣告 `sandboxEnv: {KEY: value}`——由 profile 作者（人工）在 Phase 2 問答時
// 決定主 sandbox 服務要如何連到這個 sidecar（如 DATABASE_URL），渲染器本身不對任何特定
// 資料庫/中介軟體做特殊判斷，維持跨語言/跨 sidecar 種類通用。
function renderSidecarEnvBlock(sidecarServices) {
  const lines = [];
  for (const svc of sidecarServices || []) {
    for (const [k, v] of Object.entries(svc.sandboxEnv || {})) {
      lines.push(`      ${k}: ${v}`);
    }
  }
  return lines.join('\n');
}

// ── additionalDispatchTargets 泛化（DISPATCH_REPO=service|web 的 N-target 版）───────────
// 每個 target 與本 profile 共用同一容器（baseImage/nonRootUser），只是不同工作目錄；
// 這裡把「service 固定分支 + web 固定分支」的原始寫法換成從陣列生成的 case 敘述。
function renderWorkdirCaseBranches(profile) {
  const lines = ['  service) WORKDIR=/workspace ;;'];
  for (const t of profile.additionalDispatchTargets || []) {
    lines.push(`  ${t.name}) WORKDIR=/workspace-${t.name} ;;`);
  }
  return lines.join('\n');
}

function renderTargetNamesPattern(profile) {
  return [
    'service',
    ...(profile.additionalDispatchTargets || []).map((t) => t.name),
  ].join('|');
}

function renderBootstrapCaseBranches(profile) {
  const lines = [
    `    service) run_in_sandbox '${profile.bootstrapCommand}' ;;`,
  ];
  for (const t of profile.additionalDispatchTargets || []) {
    lines.push(
      `    ${t.name}) run_in_sandbox '${t.bootstrapCommandOverride || profile.bootstrapCommand}' ;;`,
    );
  }
  return lines.join('\n');
}

function renderDepsMarkerCaseBranches(profile) {
  const lines = [
    `    service) DEPS_MARKER="$WORKDIR/${profile.depsReadyMarkerPath}" ;;`,
  ];
  for (const t of profile.additionalDispatchTargets || []) {
    lines.push(
      `    ${t.name}) DEPS_MARKER="$WORKDIR/${profile.depsReadyMarkerPath}" ;;`,
    );
  }
  return lines.join('\n');
}

function renderVerifyCaseBranches(profile) {
  const lines = [
    `    service) run_in_sandbox '${joinCommands(profile.verifyBundle || [])}' ;;`,
  ];
  for (const t of profile.additionalDispatchTargets || []) {
    const cmd =
      t.verifyBundleOverride || joinCommands(profile.verifyBundle || []);
    lines.push(`    ${t.name}) run_in_sandbox '${cmd}' ;;`);
  }
  return lines.join('\n');
}

function renderE2eCaseBranches(profile) {
  const lines = [];
  if (profile.e2eCommand) {
    lines.push(`    service) run_in_sandbox '${profile.e2eCommand}' ;;`);
  } else {
    lines.push(
      `    service) echo '${(profile.e2eUnsupportedAlternative || '此 target 不支援 --e2e').replace(/'/g, "'\\''")}' >&2; exit 65 ;;`,
    );
  }
  for (const t of profile.additionalDispatchTargets || []) {
    lines.push(
      `    ${t.name}) echo '此 target（${t.name}）尚未定義 --e2e，需要時請在 additionalDispatchTargets 補 e2e 設定' >&2; exit 65 ;;`,
    );
  }
  return lines.join('\n');
}

function renderAdditionalTargetsComposeVolumes(profile) {
  const lines = [];
  for (const t of profile.additionalDispatchTargets || []) {
    lines.push(`      - ${t.hostRelativePath}:${t.containerWorkdir}`);
    lines.push(`      - ./mcp.sandbox.json:${t.containerWorkdir}/.mcp.json:ro`);
    for (const v of t.depsCacheVolumes || []) {
      lines.push(`      - ${v.volumeName}:${v.containerPath}`);
    }
  }
  return lines.join('\n');
}

function buildTokens(profile) {
  const universalDomains = [
    'api.anthropic.com',
    'claude.ai',
    'console.anthropic.com',
    'statsig.anthropic.com',
  ];
  const allDomains = [
    ...universalDomains,
    ...(profile.firewallStackDomains || []),
  ];
  const enabledToggleDomains = (profile.firewallOptionalToggles || [])
    .filter((t) => t.defaultOn)
    .flatMap((t) => t.domains);

  const tokens = {
    ID: profile.id,
    DISPLAY_NAME: profile.displayName,
    STACK_SUMMARY: profile.stackSummary,
    BASE_IMAGE: profile.baseImage,
    NON_ROOT_USER: profile.nonRootUser,
    EXTRA_OS_PACKAGES: (profile.extraOsPackages || []).join(' '),
    PACKAGE_MANAGER: profile.packageManager,
    BOOTSTRAP_COMMAND: profile.bootstrapCommand,
    DEPS_READY_MARKER_PATH: profile.depsReadyMarkerPath,
    DEPS_CACHE_VOLUME_MOUNTS: renderVolumeMounts(
      profile.depsCacheVolumes || [],
    ),
    TOP_LEVEL_VOLUMES: renderTopLevelVolumes(
      profile.depsCacheVolumes,
      profile.sidecarServices,
      profile.additionalDispatchTargets,
    ),
    SIDECAR_ENV_BLOCK: renderSidecarEnvBlock(profile.sidecarServices),
    ADDITIONAL_TARGETS_COMPOSE_VOLUMES:
      renderAdditionalTargetsComposeVolumes(profile),
    WORKDIR_CASE_BRANCHES: renderWorkdirCaseBranches(profile),
    DISPATCH_REPO_NAMES_PATTERN: renderTargetNamesPattern(profile),
    BOOTSTRAP_CASE_BRANCHES: renderBootstrapCaseBranches(profile),
    DEPS_MARKER_CASE_BRANCHES: renderDepsMarkerCaseBranches(profile),
    VERIFY_CASE_BRANCHES: renderVerifyCaseBranches(profile),
    E2E_CASE_BRANCHES: renderE2eCaseBranches(profile),
    RESET_DB_COMMAND:
      profile.resetDbCommand ||
      `echo '此技術棧不支援 --reset-db：${profile.resetDbUnavailableReason || ''}' >&2; exit 65`,
    SIDECAR_SERVICES_BLOCK: renderSidecarComposeBlock(profile.sidecarServices),
    DEPENDS_ON_BLOCK: renderDependsOnBlock(profile.sidecarServices),
    VERIFY_BUNDLE_CHAIN: joinCommands(profile.verifyBundle || []),
    DIFF_COV_TOOL: profile.diffCoverage?.tool || '',
    DIFF_COV_THRESHOLD: String(profile.diffCoverage?.threshold ?? 90),
    DIFF_COV_LCOV_PATH: profile.diffCoverage?.lcovPath || 'coverage/lcov.info',
    DIFF_COV_EXEMPTIONS_JS: JSON.stringify(
      profile.diffCoverage?.fileExemptionRules || [],
      null,
      2,
    ),
    E2E_COMMAND: profile.e2eCommand || '',
    E2E_UNSUPPORTED_ALTERNATIVE: profile.e2eUnsupportedAlternative || '',
    SIDECAR_TCP_CHECKS_JS: JSON.stringify(
      (profile.sidecarServices || [])
        .filter((s) => s.containerPort)
        .map((s) => ({ name: s.name, port: s.containerPort })),
    ),
    FIREWALL_DOMAINS_BASH: bashArrayLiteral([
      ...new Set([...allDomains, ...enabledToggleDomains]),
    ]),
    HOST_BLOCKED_COMMANDS_PATTERN: (profile.hostBlockedCommands || []).join(
      ' | ',
    ),
    NON_ROOT_HOME: `/home/${profile.nonRootUser}`,
    POST_EDIT_FORMATTER_COMMAND: profile.postEditFormatter?.command || '',
    POST_EDIT_LINTER_COMMAND: profile.postEditLinter?.command || '',
    POST_EDIT_LINTER_EXT_CASE: (profile.postEditLinter?.extensions || [])
      .map((e) => `*${e}`)
      .join(' | '),
    TYPE_ESCAPE_CHECK_COMMAND: profile.typeEscapeHatchCheck?.command || '',
    TYPE_ESCAPE_CHECK_DESCRIPTION:
      profile.typeEscapeHatchCheck?.description || '',
    TRACKER_ADAPTER_ID: profile.trackerAdapterId || '',
  };

  const flags = {
    HAS_SIDECAR: (profile.sidecarServices || []).length > 0,
    HAS_RESET_DB: !!profile.resetDbCommand,
    HAS_E2E: !!profile.e2eCommand,
    SDD_SKILL_GUARD: !!profile.sddSkillGuardEnabled,
    TRACKER_CARD_GUARD: !!profile.trackerCardInjectionGuardEnabled,
    // 空清單時整個 Bash case 區塊不生成——否則會渲染出 `case "$w" in\n )` 這種語法錯誤的
    // shell，hook 一載入就爆、等於整支 guard 失效（比沒有黑名單更糟，因為失效是靜默的）。
    HAS_HOST_BLOCKED_COMMANDS: (profile.hostBlockedCommands || []).length > 0,
    HAS_TYPE_ESCAPE_CHECK: !!profile.typeEscapeHatchCheck,
    HAS_POST_EDIT_FORMATTER: !!profile.postEditFormatter,
    HAS_POST_EDIT_LINTER: !!profile.postEditLinter,
    // Claude Code CLI 一律需要 Node/npm 才能 `npm install -g @anthropic-ai/claude-code`；
    // 只有 npm/pnpm/yarn 生態系的 baseImage 保證內建 Node，其餘技術棧需額外裝一份 Node
    // 只為了跑 claude CLI 本身（沙盒側工具語言與目標專案語言無關，見 README.md 附註）。
    NEEDS_NODE_INSTALL: !['npm', 'pnpm', 'yarn'].includes(
      profile.packageManager,
    ),
  };

  return { tokens, flags };
}

// ── 樣板渲染引擎 ────────────────────────────────────────────────────────
// 兩種寫法皆支援：
//   1. 區塊形式——{{#IF flag}} 與 {{/IF}} 各自獨占一行，中間可跨多行。
//   2. 行內形式——同一行內 {{#IF flag}}...{{/IF}} 頭尾都在，用於一行內某個 case
//      分支只想「多加幾個 pattern」而不想整條 case 敘述另起一行的場合（如
//      sandbox-guard.sh.tmpl 的治理路徑允許清單）。
// 行內形式不支援巢狀；同一行只會處理第一層配對。
function renderInlineIfSpans(line, flags) {
  return line.replace(
    /\{\{#IF\s+(\w+)\}\}(.*?)\{\{\/IF\}\}/g,
    (whole, flagName, inner) => (flags[flagName] ? inner : ''),
  );
}

function renderIfBlocks(text, flags) {
  const lines = text.split('\n');
  const out = [];
  const stack = []; // {keep: boolean}
  for (const line of lines) {
    const openMatch = line.match(/^(\s*)\{\{#IF\s+(\w+)\}\}\s*$/);
    const closeMatch = line.match(/^\s*\{\{\/IF\}\}\s*$/);
    if (openMatch) {
      const flagName = openMatch[2];
      const parentKeep = stack.length === 0 || stack[stack.length - 1].keep;
      stack.push({ keep: parentKeep && !!flags[flagName] });
      continue;
    }
    if (closeMatch) {
      stack.pop();
      continue;
    }
    const currentKeep = stack.length === 0 || stack.every((s) => s.keep);
    if (currentKeep) out.push(renderInlineIfSpans(line, flags));
  }
  return out.join('\n');
}

function substituteTokens(text, tokens) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(tokens, name)) return tokens[name];
    return whole; // 未知 token 保留原樣，讓後續殘留掃描抓到
  });
}

// 掃描任何殘留 {{...}}——不限定字元集，涵蓋合法 token（不存在於 tokens 表）與寫壞的
// {{#IF}}/{{/IF}}/{{#SKIP_IF_NOT}} 指令（如行內 {{#IF x}}...{{/IF}} 誤用導致沒被消化）。
const LEFTOVER_RE = /\{\{[^}]*\}\}/g;

function findLeftoverTokens(tree) {
  const leftovers = [];
  for (const file of tree) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(LEFTOVER_RE);
    if (matches) leftovers.push({ file, matches: [...new Set(matches)] });
  }
  return leftovers;
}

function checkYamlQuoting(tree) {
  const problems = [];
  for (const file of tree) {
    if (!/\.ya?ml$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (/:\s*\{\{/.test(line)) {
        problems.push(
          `${file}:${idx + 1}: 未加引號的 {{ 值（YAML flow-mapping 風險）：${line.trim()}`,
        );
      }
    });
  }
  return problems;
}

function checkJsonValidity(tree) {
  const problems = [];
  for (const file of tree) {
    if (!file.endsWith('.json')) continue;
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push(`${file}: JSON 解析失敗（${e.message}）`);
    }
  }
  return problems;
}

const DEAD_CODE_MARKERS = ['/opt/fakebin', 'dispatch-watchdog.sh'];

function checkDeadCodeNotPropagated(tree) {
  const problems = [];
  for (const file of tree) {
    if (file.endsWith('dispatch-watchdog-host.sh')) continue; // 合法檔名含 dispatch-watchdog 子字串
    const content = readFileSync(file, 'utf8');
    for (const marker of DEAD_CODE_MARKERS) {
      if (content.includes(marker))
        problems.push(`${file}: 出現不可傳播項目「${marker}」`);
    }
  }
  return problems;
}

function planOutputPath(templateFile, templatesRoot, outRoot) {
  const rel = relative(templatesRoot, templateFile);
  const isVerbatim =
    rel.startsWith(`verbatim${sep}`) || rel.startsWith('verbatim/');
  const stripped = isVerbatim
    ? rel.replace(/^verbatim[\\/]/, '')
    : rel.replace(/\.tmpl$/, '');
  // 樣板檔案自身的相對路徑即目標相對路徑（如 Dockerfile.tmpl → Dockerfile、
  // sandbox.md.tmpl → .claude/rules/sandbox.md，由呼叫端在 profile 外部決定實際 out 前綴）。
  return join(outRoot, stripped);
}

function diffSummary(existingPath, newContent) {
  if (!existsSync(existingPath)) return '（新檔）';
  const oldLines = readFileSync(existingPath, 'utf8').split('\n');
  const newLines = newContent.split('\n');
  let firstDiff = -1;
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] !== newLines[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1) return '（內容相同）';
  return `（既有檔案，首個差異在第 ${firstDiff + 1} 行；舊 ${oldLines.length} 行 → 新 ${newLines.length} 行）`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    if (!args.out) {
      console.error('用法：render-profile.mjs --check --out <target-root>');
      process.exit(64);
    }
    const tree = walk(args.out);
    const problems = [
      ...findLeftoverTokens(tree).map(
        (l) => `${l.file}: 殘留 token ${l.matches.join(', ')}`,
      ),
      ...checkYamlQuoting(tree),
      ...checkJsonValidity(tree),
      ...checkDeadCodeNotPropagated(tree),
    ];
    if (problems.length) {
      console.error('render-profile --check FAIL：');
      problems.forEach((p) => console.error(`  - ${p}`));
      process.exit(1);
    }
    console.log(
      'render-profile --check OK：無殘留 token、YAML 引號正確、無不可傳播項目',
    );
    process.exit(0);
  }

  if (!args.profile || !args.templates || !args.out) {
    console.error(
      '用法：render-profile.mjs --profile <profile.json> --templates <dir> --out <target-root> [--dry-run]',
    );
    process.exit(64);
  }

  const profile = JSON.parse(readFileSync(args.profile, 'utf8'));
  const { tokens, flags } = buildTokens(profile);

  if (!flags.HAS_HOST_BLOCKED_COMMANDS) {
    console.warn(
      '⚠️  profile 未提供 hostBlockedCommands（必填欄位）：生成的 sandbox-guard.sh 將不含 host 端 Bash 黑名單，' +
        '碼類指令可在 host 直接執行。請補齊該欄位後重新生成。',
    );
  }
  const templateFiles = walk(args.templates);

  const planned = [];
  for (const tf of templateFiles) {
    if (
      tf.endsWith('.tmpl') ||
      relative(args.templates, tf).startsWith('verbatim')
    ) {
      const raw = readFileSync(tf, 'utf8');
      // 檔案級跳過：樣板第一行若是 {{#SKIP_IF_NOT flagName}}，flag 不為 truthy 時整個檔案
      // 不生成（連空檔都不建）——用於只在特定選項開啟時才有意義的檔案（如型別逃生口檢查、
      // 格式化/linter hook；多數語言無對應項時不該生出一支永遠 no-op 的檔案）。
      const skipMatch = raw.match(/^\{\{#SKIP_IF_NOT\s+(\w+)\}\}\n/);
      if (skipMatch && !flags[skipMatch[1]]) continue;
      const body = skipMatch ? raw.slice(skipMatch[0].length) : raw;
      const outPath = planOutputPath(tf, args.templates, args.out);
      const afterIf = renderIfBlocks(body, flags);
      const rendered = substituteTokens(afterIf, tokens);
      planned.push({ outPath, rendered });
    }
  }

  if (args.dryRun) {
    console.log(`render-profile --dry-run：將寫入 ${planned.length} 個檔案：`);
    for (const p of planned) {
      console.log(`  ${p.outPath} ${diffSummary(p.outPath, p.rendered)}`);
    }
    // checkYamlQuoting/checkJsonValidity/checkDeadCodeNotPropagated 皆讀磁碟檔案，dry-run 尚未寫入，
    // 故改為對記憶體內容跑同等掃描（不落地）。
    const memProblems = [];
    for (const p of planned) {
      if (/\.ya?ml$/.test(p.outPath)) {
        p.rendered.split('\n').forEach((line, idx) => {
          if (/:\s*\{\{/.test(line))
            memProblems.push(
              `${p.outPath}:${idx + 1}: 未加引號的 {{ 值：${line.trim()}`,
            );
        });
      }
      if (p.outPath.endsWith('.json')) {
        try {
          JSON.parse(p.rendered);
        } catch (e) {
          memProblems.push(`${p.outPath}: JSON 解析失敗（${e.message}）`);
        }
      }
      const leftover = p.rendered.match(LEFTOVER_RE);
      if (leftover)
        memProblems.push(
          `${p.outPath}: 殘留 token ${[...new Set(leftover)].join(', ')}`,
        );
      for (const marker of DEAD_CODE_MARKERS) {
        if (
          !p.outPath.endsWith('dispatch-watchdog-host.sh') &&
          p.rendered.includes(marker)
        ) {
          memProblems.push(`${p.outPath}: 出現不可傳播項目「${marker}」`);
        }
      }
    }
    if (memProblems.length) {
      console.error('dry-run 驗證發現問題：');
      memProblems.forEach((m) => console.error(`  - ${m}`));
      process.exit(1);
    }
    console.log(
      'dry-run 驗證通過（無殘留 token / YAML 引號問題 / 不可傳播項目）',
    );
    process.exit(0);
  }

  for (const p of planned) {
    mkdirSync(dirname(p.outPath), { recursive: true });
    writeFileSync(p.outPath, p.rendered, 'utf8');
    if (extname(p.outPath) === '.sh') {
      try {
        chmodSync(p.outPath, 0o755);
      } catch {
        /* 非 POSIX 環境忽略 */
      }
    }
  }
  console.log(`render-profile：已寫入 ${planned.length} 個檔案於 ${args.out}`);

  const tree = walk(args.out);
  const problems = [
    ...findLeftoverTokens(tree).map(
      (l) => `${l.file}: 殘留 token ${l.matches.join(', ')}`,
    ),
    ...checkYamlQuoting(tree),
    ...checkJsonValidity(tree),
    ...checkDeadCodeNotPropagated(tree),
  ];
  if (problems.length) {
    console.error(
      'render-profile：寫入後驗證 FAIL（輸出已落地，請人工檢視後修正或重跑）：',
    );
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log('render-profile：寫入後驗證通過');
}

main();
