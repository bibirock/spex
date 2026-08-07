#!/usr/bin/env bash
# 沙盒上下文清理——清掉沙盒內 ~/.claude 跨 session 累積的載體，給每個 host 工作 session 一個乾淨基線，
# 避免「上一張卡 / 上一輪」的 memory、對話 transcript、per-session 狀態滲進新的派工。
#
# 清理（累積載體）：
#   projects/*         每次派工的對話 transcript（.jsonl）＋ 自動注入的 memory
#   tasks/*            per-session todo 清單
#   session-env/*      per-session 環境快照
#   shell-snapshots/*  per-session shell 快照
#   sessions/*         session 中繼狀態
# 保留（非累積 / 一旦誤刪代價高）：
#   .credentials.json  訂閱登入 token（清掉＝每次要重登，故絕不動）
#   settings.json / plugins / backups / *cache*.json / .last-cleanup
#
# 關鍵：~/.claude 整個是 named volume（claude_config），故「docker compose restart」清不掉這些累積；
# 直接砍 volume 又會連 token 一起清。本腳本針對性刪累積載體、保留 token，是唯一兼顧兩者的做法。
#
# 用法：
#   sandbox/reset-context.sh     手動清理求純淨基線（容器未啟動則先冪等拉起）
# 亦由 dispatch.sh 於「每個 host session 首次派工」時自動呼叫一次。
set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$SANDBOX_DIR/docker-compose.sandbox.yml")

# 容器未起則靜默拉起（冪等）；拉不起就略過而非硬失敗（清理是 best-effort 前置，不該擋住呼叫端）
if ! "${COMPOSE[@]}" --progress quiet up -d sandbox >/dev/null 2>&1; then
  echo "reset-context: 沙盒容器無法啟動，略過清理" >&2
  exit 0
fi

"${COMPOSE[@]}" exec -T sandbox bash -c '
  set -u
  cd ~/.claude 2>/dev/null || { echo "reset-context: 找不到 ~/.claude，略過"; exit 0; }
  before=$(find projects tasks session-env shell-snapshots sessions -mindepth 1 2>/dev/null | wc -l | tr -d " ")
  rm -rf projects/* tasks/* session-env/* shell-snapshots/* sessions/* 2>/dev/null || true
  # 保護哨兵：登入 token 必須還在——若不見了代表刪錯了，立刻讓呼叫端看見
  if [ ! -f .credentials.json ]; then
    echo "reset-context: ⚠️ .credentials.json 不見了（不該發生，登入可能被清）" >&2
    exit 1
  fi
  echo "reset-context: 已清 ${before} 個累積項（transcript/memory/tasks/session-env/shell-snapshots/sessions），保留 credentials/settings/plugins"
'
