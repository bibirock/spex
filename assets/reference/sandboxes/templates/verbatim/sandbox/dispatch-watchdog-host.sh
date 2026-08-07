#!/usr/bin/env bash
# host 側看門狗 + 影子流捕獲（反造假硬閘）。
#
# 取代容器內 dispatch-watchdog.sh 的信任缺陷：容器內 result 檔位於 /workspace（rw bind mount），
# 沙盒 agent 可用 Bash 直接改寫、注入偽造的 tool_result 事件 → stream 稽核可被繞過。
# 本腳本在 HOST 執行 docker exec，stdout 管線即時 tee 兩份：
#   影子流（WD_SHADOW，repo 之外的 host 路徑）——容器物理不可寫，challenge-audit 唯一信任來源；
#   鏡像檔（WD_MIRROR，sandbox/tasks/ 掛載區）——沙盒可見、Monitor grep sentinel 沿用，僅供觀察不供稽核。
# agent 事後竄改鏡像檔不影響影子流（tee 寫的是 exec stdout 管線，不回讀掛載檔）。
#
# 停滯判定：影子流 mtime 連續 WD_STALE 秒無進展 → 判 hung；WD_HARDCAP 絕對上限。
# 殺法：host kill exec client + 容器內 pkill claude（exec client 死不代表容器行程死）。
set -u

: "${WD_PROMPT:?WD_PROMPT 未設（host 路徑）}"
: "${WD_SHADOW:?WD_SHADOW 未設（host-only 影子流路徑）}"
: "${WD_MIRROR:?WD_MIRROR 未設（掛載區鏡像路徑）}"
: "${WD_CMD:?WD_CMD 未設}"
: "${WD_COMPOSE:?WD_COMPOSE 未設（compose 檔路徑）}"
STALE="${WD_STALE:-0}"
HARDCAP="${WD_HARDCAP:-7200}"
POLL="${WD_POLL:-20}"
WD_WORKDIR="${WD_WORKDIR:-/workspace}" # 跨 target dispatch 由 dispatch.sh 傳入 /workspace-<name>

mkdir -p "$(dirname "$WD_SHADOW")"
: >"$WD_SHADOW"
: >"$WD_MIRROR"

mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || date +%s; }

docker compose -f "$WD_COMPOSE" exec -T sandbox \
  bash -o pipefail -c "cd $WD_WORKDIR && $WD_CMD 2>&1 | tee /proc/1/fd/1" \
  <"$WD_PROMPT" 2>&1 | tee -a "$WD_MIRROR" >>"$WD_SHADOW" &
CPID=$!
START="$(date +%s)"
REASON=""

while kill -0 "$CPID" 2>/dev/null; do
  sleep "$POLL"
  NOW="$(date +%s)"
  MT="$(mtime_of "$WD_SHADOW")"
  if [ "$STALE" -gt 0 ] && [ $((NOW - MT)) -ge "$STALE" ]; then
    REASON="stale ${STALE}s 無輸出（判定 hung）"
  elif [ $((NOW - START)) -ge "$HARDCAP" ]; then
    REASON="hardcap ${HARDCAP}s（絕對上限）"
  else
    continue
  fi
  docker compose -f "$WD_COMPOSE" exec -T sandbox pkill -f 'claude -p' 2>/dev/null
  sleep 2
  kill "$CPID" 2>/dev/null
  sleep 2
  kill -9 "$CPID" 2>/dev/null
  break
done

wait "$CPID" 2>/dev/null
EC=$?
ELAPSED=$(( $(date +%s) - START ))

# opus headless 續行 quirk 偵測：clean 結束（未被看門狗 kill）但載 Skill／派發 subagent 後
# 未交棒 → 標 [RESUME-NEEDED session_id=…]，供批次排程自動 dispatch.sh --resume 接回。
# 寫在 DISPATCH-DONE 之前：Monitor 見到完成 sentinel 時 RESUME-NEEDED 已在檔內，同一輪就能判。
# 只在正常結束時判（被 kill 的 hung 屬另種故障，走 stale/hardcap 途）。
if [ -z "$REASON" ]; then
  SB_DIR="$(cd "$(dirname "$WD_COMPOSE")" && pwd)"
  if [ -f "$SB_DIR/resume-check.py" ]; then
    RC_OUT="$(python3 "$SB_DIR/resume-check.py" "$WD_SHADOW" 2>/dev/null)"; RC_EC=$?
    if [ "$RC_EC" -eq 10 ]; then
      SID="$(printf '%s' "$RC_OUT" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("session_id") or "")' 2>/dev/null)"
      for f in "$WD_SHADOW" "$WD_MIRROR"; do
        echo "[RESUME-NEEDED session_id=${SID} reason=opus-turn-end-no-handoff]" >>"$f"
      done
    fi
  fi
fi

for f in "$WD_SHADOW" "$WD_MIRROR"; do
  [ -n "$REASON" ] && echo "[WATCHDOG] $REASON → killed" >>"$f"
  echo "[DISPATCH-DONE exit=${EC} elapsed=${ELAPSED}s]" >>"$f"
done
