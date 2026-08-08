#!/usr/bin/env bash
# spex 合併硬閘（Claude Code PreToolUse hook，exit 2 = 擋下該次工具呼叫）。
#
# 核心命題：**開 PR 可逆，合併不可逆**。PR 開立自 v0.9.0 起回歸一般流程；真正需要人把關的是
# 「把程式碼合進共用分支」這一步。本 hook 由 harness 執行、模型停不掉，**無逃生口**——
# 互動 session 也不放行，合併一律由人類到平台 UI 操作。
#
# 擋三類通道（見 rules/sdd-workflow.md「PR 合併控管」）：
#   1. MCP 參數層——`update_pull_request` 帶 status=completed、任何 PR 呼叫帶 autoComplete /
#      autoCompleteSetBy / completionOptions、以及 *merge_pull_request 類工具。
#      這一類是 `permissions.deny` 表達不了的：同一個工具也用來改 title / description，
#      工具層粒度分不出「改內容」與「合併」，只有讀得到 tool_input 的 hook 擋得到。
#   2. 平台 CLI——gh pr merge、gh pr review --approve、az repos pr update --status completed、
#      az repos pr set-vote。
#   3. 繞過 PR 直推保護分支——git push 目標分支落在保護清單（含 --all / --mirror / --delete）。
#      注意：`git push` 到 feature 分支是 spex-pull-request 的必經步驟，故**不可**用 deny 封整條，
#      只能像這裡逐次解析目標分支。
#
# 保護分支清單見下方 PROTECTED 預設值（來源＝rules/sdd-workflow.md「Branch Policy」，改動須同步）；
# 分支命名不同的專案可用 SPEX_PROTECTED_BRANCHES 環境變數覆寫（逗號分隔）。
#
# 已知邊界（誠實標註）：Bash 比對是**字面解析**，對 compound command、shell 函式 wrapper、alias、
# env-var 內插不完備；MCP 參數層則是精確判定。**本層擋的是「自動觸發」，不是有心人的刻意繞過。**
set -u

input="$(cat)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "spex 合併硬閘：缺少 $1，無法判定 → 保守拒絕。請安裝後重試（或有意識地移除本 hook，屬防護降級須留痕）。" >&2; exit 2; }; }
need jq

tool_name="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null || true)"
[ -n "$tool_name" ] || exit 0

deny() {
  echo "spex 合併硬閘：$1" >&2
  echo "合併 PR 一律由人類於平台 UI 操作（rules/sdd-workflow.md「PR 合併控管」）。本閘由 harness 執行、無逃生口；移除它屬有意識的防護降級，須在當次任務鏈留痕。" >&2
  exit 2
}

# 保護分支清單：環境變數優先，否則用預設（與 Branch Policy 同步）
PROTECTED="${SPEX_PROTECTED_BRANCHES:-main,master,dev,develop,development}"

is_protected() {
  local target="$1" b
  # 正規化：去 refs/heads/ 前綴、去強推的 + 前綴、轉小寫
  target="${target#+}"
  target="${target#refs/heads/}"
  target="$(tr '[:upper:]' '[:lower:]' <<<"$target")"
  [ -n "$target" ] || return 1
  local IFS=','
  for b in $PROTECTED; do
    b="$(tr '[:upper:]' '[:lower:]' <<<"$b" | tr -d '[:space:]')"
    [ -n "$b" ] && [ "$target" = "$b" ] && return 0
  done
  return 1
}

# ── (1) MCP 參數層 ──────────────────────────────────────────────────────
case "$tool_name" in
  mcp__*)
    # 合併專用工具（GitHub MCP 的 merge_pull_request 等）：不看參數，一律擋
    case "$tool_name" in
      *merge_pull_request* | *pull_request*merge*)
        deny "禁止呼叫合併工具 ${tool_name}。"
        ;;
    esac

    # 只對 PR 類工具檢查參數；其他 MCP 呼叫（讀卡片、寫留言…）放行
    case "$tool_name" in
      *pull_request*)
        status="$(jq -r '.tool_input.status // empty' <<<"$input" 2>/dev/null || true)"
        if [ "$(tr '[:upper:]' '[:lower:]' <<<"$status")" = 'completed' ]; then
          deny "禁止以 ${tool_name} 把 PR 狀態改為 completed——那就是合併。"
        fi
        # autoComplete 家族＝預約自動合併：只要不是 false / null / 空即視為開啟
        auto="$(jq -r '[.tool_input.autoComplete?, .tool_input.autoCompleteSetBy?, .tool_input.completionOptions?]
                       | map(select(. != null and . != false and . != "" and . != {})) | length' <<<"$input" 2>/dev/null || echo 0)"
        if [ "${auto:-0}" != '0' ]; then
          deny "禁止在 ${tool_name} 帶 autoComplete / autoCompleteSetBy / completionOptions——那是預約自動合併。"
        fi
        ;;
    esac
    exit 0
    ;;
  Bash) ;;
  *) exit 0 ;;
esac

# ── (2)(3) Bash：平台 CLI 合併指令與繞過 PR 的直推 ──────────────────────
cmd="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null || true)"
[ -n "$cmd" ] || exit 0

# 把 pipeline / 連接詞拆段，逐段獨立判定（compound command 至少不會整條漏掉）
segments="$(tr '\n' ';' <<<"$cmd" | sed -E 's/(\|\||&&|\||;)/\n/g')"

while IFS= read -r seg; do
  [ -n "$seg" ] || continue

  case "$seg" in
    *gh*\ pr\ *merge* | *gh*\ pr*merge*)
      grep -qE '(^|[[:space:]])gh([[:space:]]+[-a-z]+)*[[:space:]]+pr[[:space:]]+merge\b' <<<"$seg" &&
        deny "禁止 gh pr merge。"
      ;;
  esac

  if grep -qE '(^|[[:space:]])gh([[:space:]]+[-a-z]+)*[[:space:]]+pr[[:space:]]+review\b' <<<"$seg"; then
    grep -qE '(^|[[:space:]])(--approve|-a)([[:space:]]|$)' <<<"$seg" &&
      deny "禁止 gh pr review --approve——自我核准等於變相放行合併。"
  fi

  if grep -qE '(^|[[:space:]])az[[:space:]]+repos[[:space:]]+pr[[:space:]]+set-vote\b' <<<"$seg"; then
    deny "禁止 az repos pr set-vote——自我投票等於變相放行合併。"
  fi

  if grep -qE '(^|[[:space:]])az[[:space:]]+repos[[:space:]]+pr[[:space:]]+update\b' <<<"$seg"; then
    grep -qE '\-\-status[[:space:]=]+completed\b' <<<"$seg" &&
      deny "禁止 az repos pr update --status completed——那就是合併（改 title / description 不受限）。"
  fi

  # ── git push：解析目標分支 ────────────────────────────────────────────
  grep -qE '(^|[[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push\b' <<<"$seg" || continue

  # --all / --mirror 必然涵蓋保護分支
  grep -qE '(^|[[:space:]])(--all|--mirror)([[:space:]]|$)' <<<"$seg" &&
    deny "禁止 git push --all / --mirror——必然涵蓋保護分支（${PROTECTED}）。"

  # 取 push 之後的非旗標引數：第一個是 remote，其餘是 refspec
  args="$(sed -E 's/.*(^|[[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push[[:space:]]*//' <<<"$seg")"
  remote_seen=0
  target=''
  for a in $args; do
    case "$a" in
      -*) continue ;; # 旗標（含 -u / --force / --delete …）一律略過
    esac
    if [ "$remote_seen" = '0' ]; then
      remote_seen=1
      continue # 第一個非旗標引數是 remote
    fi
    # refspec：有冒號取右側 dst，否則整個就是目標分支
    case "$a" in
      *:*) target="${a##*:}" ;;
      *) target="$a" ;;
    esac
    is_protected "$target" &&
      deny "禁止 git push 到保護分支 ${target}——繞過 PR 直接合入共用分支。"
  done

  # 沒有指定 refspec → 推的是當前分支（含 git push、git push origin）
  if [ -z "$target" ]; then
    repo="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)}"
    cur=''
    [ -n "$repo" ] && cur="$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    if [ -n "$cur" ] && is_protected "$cur"; then
      deny "禁止 git push——當前分支 ${cur} 為保護分支，未指定 refspec 時推的就是它。"
    fi
  fi
done <<<"$segments"

exit 0
