#!/usr/bin/env bash
# archive-done-specs.sh — local-file adapter 擴充操作實作
#   LOCALFILE.archiveDoneSpecs()  → 不帶 --id：全掃描
#   LOCALFILE.archiveItem(id)     → 帶 --id=<日期>-<slug>：只處理單一卡片
#
# 見 .claude/reference/adapters/local-file.md「擴充操作 › LOCALFILE.archiveDoneSpecs()」。
#
# 用途：把 item.md Front Matter state: done 的卡片，從 specs/<日期>/<slug>/
#       搬到 specs/_archive/<日期>/<slug>/（只搬「根目錄層」，日期層與任務層字串
#       不變，ID＝<日期>-<slug> 因此不變，見 local-file.md「ID 規則 › 封存 fallback」）。
#
# 安全性：
#   - 用 git mv（不是 mv + git add/rm）保留檔案歷史（git log --follow 可追溯）
#   - 搬移前用 git status --porcelain 檢查任務資料夾內有無未提交變更，有 → 跳過該卡，不強搬
#   - 不自動 commit：搬移只是 git mv（staged），留給呼叫者自行檢視 `git status` /
#     `git diff --cached` 後再 commit——bash 腳本沒有對話式確認機制，改用
#     「staged 但不 commit」達到同等的人工複核效果
#   - 冪等：specs/_archive/<日期>/<slug>/ 已存在的卡片一律 skip，重跑不重複搬移
#   - 退出碼一律 0（報告型工具，非硬 gate）；不在 git repo / 找不到 specs/ / 參數錯誤
#     才會以非 0 結束
#
# 用法（務必先跑一次 --dry-run 確認清單再正式執行）：
#   bash .claude/reference/adapters/scripts/archive-done-specs.sh --dry-run
#   bash .claude/reference/adapters/scripts/archive-done-specs.sh
#   bash .claude/reference/adapters/scripts/archive-done-specs.sh --id=20260814-relax-query-retrieval
#
# 可從 repo 內任何目錄執行（腳本會自動 cd 到 git 根目錄）。
set -u

DRY_RUN=0
ONLY_ID=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --id=*)
      ONLY_ID="${arg#--id=}"
      ;;
    -h | --help)
      cat <<'EOF'
用法：archive-done-specs.sh [--dry-run] [--id=<日期>-<slug>]

  （無旗標）        全掃描 specs/*/*/item.md，封存所有 state: done 且尚未封存的卡片
  --dry-run         只列出將執行的動作，不實際 git mv
  --id=<id>         只處理單一卡片（<id> 格式同 ID 規則：<日期>-<slug>）
  -h, --help        顯示本說明

退出碼一律 0；非 0 只用於「無法執行」（不在 git repo / 找不到 specs/ / 參數錯誤）。
EOF
      exit 0
      ;;
    *)
      echo "錯誤：未知參數 '$arg'（--help 查看用法）" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "錯誤：目前目錄不在 git 工作樹內。本腳本依賴 git mv 保留檔案歷史，無法在無 git 環境執行。" >&2
  exit 1
fi
cd "$REPO_ROOT" || exit 1

if [ ! -d "specs" ]; then
  echo "錯誤：repo 根目錄（${REPO_ROOT}）下找不到 specs/ 目錄，此 repo 未使用 local-file adapter 慣例，無事可做。" >&2
  exit 1
fi

archived=0
skipped_not_done=0
skipped_already=0
skipped_dirty=0
skipped_other=0

# 處理單一 <日期>/<slug> 任務資料夾；由全掃描迴圈與 --id 模式共用
process_item() {
  date_name="$1"
  slug_name="$2"
  id="${date_name}-${slug_name}"
  slug_dir="specs/${date_name}/${slug_name}"
  item_file="${slug_dir}/item.md"

  if [ ! -f "$item_file" ]; then
    echo "SKIP      ${id}  no-item-md（${item_file} 不存在，非標準任務資料夾）"
    skipped_other=$((skipped_other + 1))
    return
  fi

  state="$(sed -n '/^---$/,/^---$/p' "$item_file" | grep -m1 '^state:' | sed -E 's/^state:[[:space:]]*//' | tr -d '\r')"

  if [ "$state" != "done" ]; then
    echo "SKIP      ${id}  not-done（state=${state:-<空>}）"
    skipped_not_done=$((skipped_not_done + 1))
    return
  fi

  dest_dir="specs/_archive/${date_name}"
  dest_path="${dest_dir}/${slug_name}"

  if [ -e "$dest_path" ]; then
    echo "SKIP      ${id}  already-archived（${dest_path} 已存在）"
    skipped_already=$((skipped_already + 1))
    return
  fi

  dirty="$(git status --porcelain -- "$slug_dir")"
  if [ -n "$dirty" ]; then
    echo "SKIP      ${id}  dirty-worktree（${slug_dir} 內有未提交變更，請先 commit 或 stash 後重跑）"
    skipped_dirty=$((skipped_dirty + 1))
    return
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN   ${id}  would-archive（${slug_dir} → ${dest_path}）"
    return
  fi

  mkdir -p "$dest_dir"
  if git mv "$slug_dir" "$dest_path"; then
    echo "ARCHIVED  ${id}  （${slug_dir} → ${dest_path}；已 git mv staged，尚未 commit，請檢視後自行 commit）"
    archived=$((archived + 1))
  else
    echo "ERROR     ${id}  git-mv-failed（見上方 git 錯誤訊息；此卡未搬移，其餘卡片繼續處理）"
  fi
}

if [ -n "$ONLY_ID" ]; then
  if [[ "$ONLY_ID" =~ ^([0-9]{8})-(.+)$ ]]; then
    process_item "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  else
    echo "錯誤：--id='${ONLY_ID}' 不符合 ID 規則 ^(\\d{8})-(.+)\$（見 local-file.md「ID 規則」）" >&2
    exit 1
  fi
else
  for date_dir in specs/*/; do
    date_dir="${date_dir%/}"
    date_name="$(basename "$date_dir")"

    [ "$date_name" = "_archive" ] && continue
    [[ "$date_name" =~ ^[0-9]{8}$ ]] || continue

    for slug_dir in "$date_dir"/*/; do
      [ -d "$slug_dir" ] || continue
      slug_dir="${slug_dir%/}"
      slug_name="$(basename "$slug_dir")"
      process_item "$date_name" "$slug_name"
    done
  done
fi

echo "---"
echo "封存掃描完成：archived=${archived}  skipped-not-done=${skipped_not_done}  skipped-already-archived=${skipped_already}  skipped-dirty=${skipped_dirty}  skipped-other=${skipped_other}"
[ "$DRY_RUN" -eq 1 ] && echo "（--dry-run 模式：以上為模擬結果，未實際搬移任何檔案）"

exit 0
