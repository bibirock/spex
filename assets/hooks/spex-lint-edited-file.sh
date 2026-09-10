#!/usr/bin/env bash
# spex lint hook（PostToolUse）：代理透過 Edit / Write / MultiEdit 異動檔案後，
# 對「剛異動的那一個檔」跑 lint。有錯誤時以 exit 2 把訊息回報給代理，讓它接著修正。
# 指令與副檔名清單來自同目錄的 spex-hooks.env（專案自行維護）；未設定即靜默停用。
set -euo pipefail

_hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 先留存環境已提供的值：設定檔是專案預設，環境變數優先（供 CI 或單次覆寫）。
_env_lint_command="${SPEX_LINT_COMMAND:-}"
_env_lint_extensions="${SPEX_LINT_EXTENSIONS:-}"
# shellcheck disable=SC1091（設定檔由專案維護，路徑在執行期才確定）
[ -f "$_hook_dir/spex-hooks.env" ] && . "$_hook_dir/spex-hooks.env"
[ -n "$_env_lint_command" ] && SPEX_LINT_COMMAND="$_env_lint_command"
[ -n "$_env_lint_extensions" ] && SPEX_LINT_EXTENSIONS="$_env_lint_extensions"

lint_cmd="${SPEX_LINT_COMMAND:-}"
[ -n "$lint_cmd" ] || exit 0

# hook 事件以 JSON 從 stdin 傳入；jq 優先，缺 jq 時以 node 解析。
_hook_input="$(cat)"
file_path="$(printf '%s' "$_hook_input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
if [ -z "$file_path" ]; then
  file_path="$(printf '%s' "$_hook_input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(((JSON.parse(s).tool_input)||{}).file_path||"")}catch(e){}})' 2>/dev/null || true)"
fi

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

# 副檔名清單留空 = 不限副檔名；有值時只 lint 命中的檔案。
extensions="${SPEX_LINT_EXTENSIONS:-}"
if [ -n "$extensions" ]; then
  matched=0
  for pattern in $extensions; do
    case "$file_path" in
      $pattern) matched=1; break ;;
    esac
  done
  [ "$matched" -eq 1 ] || exit 0
fi

# shellcheck disable=SC2086（需要讓 lint_cmd 的空白分隔旗標各自成獨立 argv）
if output="$($lint_cmd "$file_path" 2>&1)"; then
  exit 0
fi

echo "Lint 在 $file_path 發現問題，請修正：" >&2
echo "$output" >&2
exit 2
