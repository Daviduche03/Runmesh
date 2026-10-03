#!/usr/bin/env bash
# Read-only diff budget check for kill-slop.
# Does not modify the working tree, index, or git config.
#
# Usage (from the project being edited):
#   bash path/to/kill-slop/scripts/check-diff.sh
#   bash path/to/kill-slop/scripts/check-diff.sh --base HEAD
#   bash path/to/kill-slop/scripts/check-diff.sh --max-files 5
#
# Exit: 0 = within soft budget, 1 = over budget (shrink the plan), 2 = usage error

set -euo pipefail

MAX_FILES=5
BASE="HEAD"
SHOW_HELP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --max-files)
      MAX_FILES="${2:-}"
      shift 2
      ;;
    --base)
      BASE="${2:-}"
      shift 2
      ;;
    -h|--help)
      SHOW_HELP=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$SHOW_HELP" -eq 1 ]; then
  cat <<'EOF'
check-diff.sh — read-only kill-slop diff budget

Options:
  --max-files N   Soft file budget (default: 5)
  --base REF      Git ref to diff against (default: HEAD)
  -h, --help      Show help

Reports unstaged + staged + untracked changes vs REF.
Never writes to the repo.
EOF
  exit 0
fi

case "$MAX_FILES" in
  ''|*[!0-9]*)
    echo "--max-files must be a non-negative integer" >&2
    exit 2
    ;;
esac

if ! command -v git >/dev/null 2>&1; then
  echo "STATUS: SKIP"
  echo "reason: git not available"
  echo "Action: count touched files manually; keep small tasks near ${MAX_FILES} files."
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "STATUS: SKIP"
  echo "reason: not a git repository"
  echo "Action: list files you created/edited; keep small tasks near ${MAX_FILES} files."
  exit 0
fi

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "STATUS: SKIP"
  echo "reason: base ref '$BASE' not found"
  echo "Action: list files you created/edited; keep small tasks near ${MAX_FILES} files."
  exit 0
fi

CHANGED_FILE="$(mktemp)"
trap 'rm -f "$CHANGED_FILE"' EXIT

{
  git diff --name-only "$BASE" 2>/dev/null || true
  git diff --name-only --cached "$BASE" 2>/dev/null || true
  git ls-files --others --exclude-standard 2>/dev/null || true
} | sed '/^$/d' | sort -u >"$CHANGED_FILE"

file_count="$(wc -l <"$CHANGED_FILE" | tr -d ' ')"

numstat="$(
  {
    git diff --numstat "$BASE" 2>/dev/null || true
    git diff --numstat --cached "$BASE" 2>/dev/null || true
  } | awk '
    NF >= 3 {
      add=$1; del=$2
      if (add == "-") add=0
      if (del == "-") del=0
      a+=add; d+=del
    }
    END { printf "%d %d\n", a+0, d+0 }
  '
)"
lines_added="$(echo "$numstat" | awk '{print $1}')"
lines_deleted="$(echo "$numstat" | awk '{print $2}')"

untracked=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    untracked=$((untracked + 1))
  fi
done <"$CHANGED_FILE"

echo "kill-slop diff budget (read-only)"
echo "base: $BASE"
echo "files_touched: $file_count"
echo "files_untracked: $untracked"
echo "lines_added: ${lines_added:-0}"
echo "lines_deleted: ${lines_deleted:-0}"
echo "soft_max_files: $MAX_FILES"
echo ""

if [ "$file_count" -eq 0 ]; then
  echo "STATUS: OK"
  echo "No local changes vs $BASE."
  exit 0
fi

echo "files:"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  kind="modified"
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    kind="untracked"
  fi
  echo "  - [$kind] $f"
done <"$CHANGED_FILE"
echo ""

if [ "$file_count" -gt "$MAX_FILES" ]; then
  echo "STATUS: OVER_BUDGET"
  echo "Action: shrink the plan — prefer editing existing files; drop drive-bys; do not add files that can be inlined."
  exit 1
fi

echo "STATUS: OK"
echo "Within soft file budget. Still apply kill-slop self-check (no junk comments, no unrequested deps, no architecture cosplay)."
exit 0
