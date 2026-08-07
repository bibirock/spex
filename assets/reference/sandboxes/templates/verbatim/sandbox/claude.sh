#!/usr/bin/env bash
# 互動入口：啟動沙盒（含防火牆）並進入容器內的 Claude Code。
# 首次使用會引導登入訂閱帳號，token 存 named volume（claude_config），重建容器不需重登。
set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$SANDBOX_DIR/docker-compose.sandbox.yml")

# 不強制 --build（避免每次重建容器丟失 ~/.claude.json 登入狀態）；首次或 Dockerfile 變動時用 sandbox/claude.sh --build。
if [ "${1:-}" = "--build" ]; then shift; "${COMPOSE[@]}" up -d --build sandbox; else "${COMPOSE[@]}" up -d sandbox; fi
"${COMPOSE[@]}" exec sandbox sudo /usr/local/bin/init-firewall.sh 2>/dev/null || true
exec "${COMPOSE[@]}" exec sandbox claude "$@"
