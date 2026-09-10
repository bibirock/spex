#!/usr/bin/env node
/**
 * 從來源專案（預設 ../spex-source）的 .claude/ 一次性匯入 assets 到 CLI repo。
 *
 * ⚠️ 本腳本為手動 opt-in 工具，**不**在 `npm run build` / `prepare` 流程中執行。
 *    它會「整資料夾覆蓋」 assets/skills 與 assets/reference；本 repo 的 assets/
 *    現為主要維護來源，若已在本地編輯過 skills / reference，執行前請先確認
 *    要保留的變更已備份或已同步回上游，否則會被覆蓋。
 *
 * 注意：`assets/rules/`、`assets/agents/`、`assets/hooks/` 為本 repo 在地撰寫，
 *       **不**列為同步目標，本腳本不會動到它們。
 *
 * 使用方式：
 *   node scripts/sync-assets.mjs                    # 用預設來源路徑
 *   SOURCE_REPO=/path/to/repo node scripts/sync-assets.mjs
 *
 * 同步內容：
 *   <source>/.claude/skills/      → assets/skills/     （整夾覆蓋）
 *   <source>/.claude/reference/   → assets/reference/  （整夾覆蓋）
 *   <source>/playwright.config.ts → assets/templates/playwright.config.ts
 *   ~/.claude.json (MCP 設定)     → 提示使用者手動更新 src/mcp/servers.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_SOURCE = path.resolve(repoRoot, "..", "spex-source");
const sourceRepo = process.env.SOURCE_REPO ?? DEFAULT_SOURCE;
const sourceClaudeDir = path.join(sourceRepo, ".claude");

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function clearDir(dir) {
  if (!(await pathExists(dir))) return;
  await fs.rm(dir, { recursive: true, force: true });
}

async function main() {
  console.log(`[sync-assets] 來源：${sourceClaudeDir}`);
  console.warn(
    "[sync-assets] ⚠️ 將整夾覆蓋 assets/skills 與 assets/reference；assets/rules 不受影響。\n" +
      "              本 repo 的 assets/ 為主要維護來源，請確認本地編輯已備份或已同步回上游。",
  );

  if (!(await pathExists(sourceClaudeDir))) {
    console.error(`✗ 找不到來源 .claude/ 目錄：${sourceClaudeDir}`);
    console.error("  設定 SOURCE_REPO 環境變數指向來源專案路徑。");
    process.exit(1);
  }

  const targets = [
    {
      src: path.join(sourceClaudeDir, "skills"),
      dest: path.join(repoRoot, "assets", "skills"),
    },
    {
      src: path.join(sourceClaudeDir, "reference"),
      dest: path.join(repoRoot, "assets", "reference"),
    },
  ];

  for (const { src, dest } of targets) {
    if (!(await pathExists(src))) {
      console.warn(`  跳過（來源不存在）：${src}`);
      continue;
    }
    await clearDir(dest);
    await copyDir(src, dest);
    console.log(`  ✓ ${path.relative(repoRoot, dest)}`);
  }

  // 同步 playwright.config.ts 範本到 assets/templates/
  const playwrightSrc = path.join(sourceRepo, "playwright.config.ts");
  const playwrightDest = path.join(
    repoRoot,
    "assets",
    "templates",
    "playwright.config.ts",
  );
  if (await pathExists(playwrightSrc)) {
    await fs.mkdir(path.dirname(playwrightDest), { recursive: true });
    await fs.copyFile(playwrightSrc, playwrightDest);
    console.log(`  ✓ ${path.relative(repoRoot, playwrightDest)}`);
  } else {
    console.warn(`  跳過（來源不存在）：${playwrightSrc}`);
  }

  console.log("\n[sync-assets] 完成。");
  console.log("  提醒：MCP server 清單（src/mcp/servers.ts）需手動維護，");
  console.log("  若你的本機 ~/.claude.json 有新增 server，請同步到該檔。");
}

main().catch((err) => {
  console.error("[sync-assets] 失敗：", err);
  process.exit(1);
});
