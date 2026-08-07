#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error('[spex] 啟動失敗，請先執行 `npm run build`');
  console.error(err);
  process.exit(1);
});
