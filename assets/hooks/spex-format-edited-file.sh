#!/usr/bin/env bash
# spex format hook（PostToolUse）：代理透過 Edit / Write / MultiEdit 異動檔案後，
# 對「剛異動的那一個檔」跑格式化。只格式化單檔、非阻塞、安靜——不影響代理的工作流程。
# 指令來自同目錄的 spex-hooks.env（專案自行維護）；未設定即靜默停用。
set -euo pipefail

_hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 先留存環境已提供的值：設定檔是專案預設，環境變數優先（供 CI 或單次覆寫）。
_env_format_command="${SPEX_FORMAT_COMMAND:-}"
# shellcheck disable=SC1091（設定檔由專案維護，路徑在執行期才確定）
[ -f "$_hook_dir/spex-hooks.env" ] && . "$_hook_dir/spex-hooks.env"
[ -n "$_env_format_command" ] && SPEX_FORMAT_COMMAND="$_env_format_command"

format_cmd="${SPEX_FORMAT_COMMAND:-}"
[ -n "$format_cmd" ] || exit 0

_hook_input="$(cat)"
file_path="$(printf '%s' "$_hook_input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
if [ -z "$file_path" ]; then
  file_path="$(printf '%s' "$_hook_input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(((JSON.parse(s).tool_input)||{}).file_path||"")}catch(e){}})' 2>/dev/null || true)"
fi

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

# 未安裝該格式化工具、或格式化失敗（如檔案暫時語法錯誤）皆不擋流程。
# shellcheck disable=SC2086（需要讓 format_cmd 的空白分隔旗標各自成獨立 argv）
$format_cmd "$file_path" >/dev/null 2>&1 || true
