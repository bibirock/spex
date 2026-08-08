#!/usr/bin/env bash
# spex 章戳硬閘（Claude Code PreToolUse hook，exit 2 = 擋下該次工具呼叫）。
#
# 由 harness 執行，不在模型控制範圍內——這是「驗章不可跳過」的機制來源：
#   1. tracker 寫入類 MCP 呼叫，內容若含章戳宣稱（challenge：PASS（…章 X）／驗收章 X），
#      發文前強制驗章；未過一律拒發。無宣稱的留言免驗放行（plan 留言、批次分支留言等）。
#   2. 任何 Write / Edit / Bash 觸及 ~/.claude/projects/（章源所在）一律擋下——
#      章的可信度建立在「事件流由 harness 寫、執行者不改」，能改就沒有章可言。
#
# 用法：spex-stamp-guard.sh [--plane agent|sandbox]（由 spex init 依安裝版本寫入 settings.json）
#
# 為何要分平面：章戳鏈有兩個平面、兩種章源，本 hook 只在自己的平面有裁定權。
#   --plane agent  （預設）章在本 session 事件流 → 本 hook 跑 challenge-audit 裁定。
#   --plane sandbox 章在 host 影子流、由 relay 執行檔的驗章硬閘裁定。此時本 hook **不得**
#                   拿 transcript 去驗——沙盒內派的 challenger 事件根本不在 host transcript 裡，
#                   驗了必然得到「假 FAIL」。改為擋下「host 直接以 MCP 發含章留言」這條源頭，
#                   把含章寫入唯一化到 relay（見 reference/spex/relay-protocol.md）。
#
# 已知邊界（誠實標註，與 rules/sdd-workflow.md「章的強度分層」一致）：Bash 比對是字面解析，
# 對 compound / wrapper / 變數內插變體不完備；沙盒平面的「容器物理寫不到」才是更硬的邊界。
set -u

PLANE=agent
while [ $# -gt 0 ]; do
  case "$1" in
    --plane)
      [ -n "${2:-}" ] && PLANE="$2" && shift
      ;;
    --plane=*)
      PLANE="${1#--plane=}"
      ;;
  esac
  shift
done
case "$PLANE" in
  agent | sandbox) ;;
  *)
    echo "spex 章戳硬閘：未知的平面 '${PLANE}'（僅支援 agent | sandbox）→ 保守拒絕。請重新執行 spex init。" >&2
    exit 2
    ;;
esac

# 先把 stdin 收乾再做任何提前結束的判斷，避免 harness 寫入時吃到 EPIPE
input="$(cat)"

# 容器內（沙盒側程式碼平面）：transcript 落在容器可寫處，沒有可信章源；且容器零憑證、
# 寫不到 tracker（寫入一律走 [TRACKER-ACTION] → host relay）。本 hook 在此平面無事可做。
if [ "${IN_SANDBOX:-}" = '1' ] || [ -f /.dockerenv ]; then
  exit 0
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "spex 章戳硬閘：缺少 $1，無法驗章。請安裝後重試（或有意識地移除本 hook，屬防護降級須留痕）。" >&2; exit 2; }; }
need jq

tool_name="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
[ -n "$tool_name" ] || exit 0

# ── (2) 章源保護：事件流不可被執行者改寫 ────────────────────────────────
TRANSCRIPT_MARK='/.claude/projects/'
case "$tool_name" in
  Write | Edit | MultiEdit)
    fp="$(jq -r '.tool_input.file_path // empty' <<<"$input" 2>/dev/null || true)"
    case "$fp" in
      *"$TRANSCRIPT_MARK"*)
        echo "spex 章戳硬閘：禁止改寫 ${fp}——~/.claude/projects/ 是章戳鏈的事件流（章源），由 harness 寫入；可改寫即無章可信。" >&2
        exit 2
        ;;
    esac
    ;;
  Bash)
    cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
    case "$cmd" in
      *"$TRANSCRIPT_MARK"*)
        # 唯讀查看（cat/grep/head/tail/ls/wc/python3 讀檔）不阻擋，避免誤傷 spex-stamp 自己的驗章流程
        case "$cmd" in
          cat\ * | grep\ * | rg\ * | head\ * | tail\ * | ls\ * | wc\ * | node\ * | python3\ * | jq\ *) ;;
          *)
            echo "spex 章戳硬閘：禁止以 Bash 改寫 ~/.claude/projects/ 內容（章戳鏈事件流）。唯讀查詢請用 cat / grep / node / python3。" >&2
            exit 2
            ;;
        esac
        ;;
    esac
    exit 0
    ;;
esac

# ── (1) tracker 寫入的章戳驗證 ──────────────────────────────────────────
case "$tool_name" in
  mcp__*add_comment* | mcp__*create_work_item* | mcp__*update_work_item* | mcp__*create_issue* | mcp__*add_issue_comment*) ;;
  *) exit 0 ;;
esac

body="$(jq -r '[.tool_input.comment?, .tool_input.body?, .tool_input.text?, .tool_input.content?] | map(select(. != null)) | join("\n")' <<<"$input" 2>/dev/null || true)"
[ -n "$body" ] || exit 0
grep -qE 'challenge[：:][[:space:]]*PASS|驗收章' <<<"$body" || exit 0

# 沙盒平面：章在影子流，裁定者是 relay 執行檔。host 不得繞過 relay 直接發含章留言——
# 這裡擋的是源頭而非驗章結果（本 hook 在此平面沒有可信章源，驗了只會是假 FAIL）。
if [ "$PLANE" = 'sandbox' ]; then
  echo "spex 章戳硬閘（沙盒平面）：含章戳宣稱的留言必須經 host relay 寫入。章落在影子流，relay 執行檔內建的驗章硬閘才是本平面的裁定者（見 .claude/reference/spex/relay-protocol.md「驗章硬閘接線契約」）；host 直接以 MCP 發含章留言等於繞過驗章 → 拒發。" >&2
  exit 2
fi

transcript="$(jq -r '.transcript_path // empty' <<<"$input" 2>/dev/null || true)"
if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  echo "spex 章戳硬閘：留言含章戳宣稱，但取不到本 session 事件流（transcript_path 缺失或不存在），無法驗章 → 拒發。" >&2
  exit 2
fi

repo="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"
scripts="$repo/.claude/reference/spex/scripts"
[ -f "$scripts/challenge-audit.py" ] || { echo "spex 章戳硬閘：找不到 $scripts/challenge-audit.py，無法驗章 → 拒發。請重新執行 spex init。" >&2; exit 2; }
need node
need python3

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s' "$body" >"$tmp/pending.md"

if ! node "$scripts/transcript-to-stream.mjs" "$transcript" --pending "$tmp/pending.md" >"$tmp/stream.ndjson" 2>"$tmp/err"; then
  echo "spex 章戳硬閘：事件流正規化失敗 → 拒發。$(head -c 400 "$tmp/err")" >&2
  exit 2
fi

if ! out="$(cd "$repo" && python3 "$scripts/challenge-audit.py" "$tmp/stream.ndjson" 2>&1)"; then
  echo "spex 章戳硬閘：驗章未通過，拒絕寫入 tracker。" >&2
  echo "$out" >&2
  exit 2
fi

exit 0
