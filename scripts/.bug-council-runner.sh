#!/bin/bash
# Bug Council Runner v3 — Runs the daily bug council audit for BOTH repos (coconut + coconut-app),
# prunes stale PRs, gates low-value diffs, and sends ONE consolidated Telegram notification.
# Uses dedicated git worktrees so it never touches your main checkouts.
#
# Usage:
#   .bug-council-runner.sh                              # Full scheduled audit (both repos)
#   .bug-council-runner.sh --reactive "error desc"      # Quick fix for a specific issue
#   .bug-council-runner.sh --reactive-repo coconut "CI failed: tsc error in lib/foo.ts"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COCONUT_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=bug-council-lib.sh
source "$SCRIPT_DIR/bug-council-lib.sh"
export BUG_COUNCIL_LOG_DIR="$COCONUT_REPO/.bug-council-logs"
export COCONUT_REPO

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

# ── Config (override via environment) ────────────────────────────────────────
LOCKFILE="/tmp/coconut-bug-council.lock"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_TAG=$(date +%Y%m%d)

: "${TELEGRAM_BOT_TOKEN:=""}"
: "${TELEGRAM_CHAT_ID:=""}"
: "${GH_USER:="KoushikP04"}"
: "${CLAUDE:="$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")"}"

: "${COCONUT_APP_REPO:="$(dirname "$COCONUT_REPO")/coconut-app"}"

LOG_DIR="$BUG_COUNCIL_LOG_DIR"

: "${COCONUT_PROD_URL:="https://coconut-lemon.vercel.app"}"
: "${SUPABASE_SERVICE_ROLE_KEY:=""}"

# Repo configs: name|full_repo|main_repo_path|worktree_parent|has_ci|claude_command
WORKTREE_BASE="$(dirname "$COCONUT_REPO")"
REPO_CONFIGS=(
  "coconut|Coconut-Banking/coconut|$COCONUT_REPO|$WORKTREE_BASE/coconut-worktrees/bug-council|yes|bug-council.md"
  "coconut-app|Coconut-Banking/coconut-app|$COCONUT_APP_REPO|$WORKTREE_BASE/coconut-app-worktrees/bug-council|yes|bug-council-mobile.md"
)

declare -a RESULTS=()

# ── Helpers ──────────────────────────────────────────────────────────────────
notify_macos() {
  osascript -e "display notification \"$1\" with title \"Coconut Bug Council\" sound name \"Glass\"" 2>/dev/null || true
}

notify_telegram() {
  [ -z "$TELEGRAM_BOT_TOKEN" ] && return 0
  [ -z "$TELEGRAM_CHAT_ID" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d parse_mode="Markdown" \
    -d text="$1" > /dev/null 2>&1 || true
}

# ── Prevent concurrent runs ──────────────────────────────────────────────────
acquire_lock() {
  if [ -f "$LOCKFILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$lock_pid" 2>/dev/null; then
      echo "Another bug council run is still active (PID $lock_pid). Skipping."
      exit 0
    fi
    rm -f "$LOCKFILE"
  fi
  echo $$ > "$LOCKFILE"
}

# ── Cleanup trap ─────────────────────────────────────────────────────────────
cleanup() {
  echo "Cleaning up..."
  pkill -TERM -P $$ 2>/dev/null || true
  sleep 1
  pkill -KILL -P $$ 2>/dev/null || true
  pgrep -f "claude.*bug-council" | xargs kill -9 2>/dev/null || true
  jobs -p 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -f "$LOCKFILE"
}
trap cleanup EXIT INT TERM

# ── Reactive mode: fix a specific issue quickly ──────────────────────────────
run_reactive() {
  local target_repo="${1:-coconut}"
  local error_description="$2"

  local repo_path repo_name full_repo
  if [ "$target_repo" = "coconut" ] || [ "$target_repo" = "web" ]; then
    repo_path="$COCONUT_REPO"
    repo_name="coconut"
    full_repo="Coconut-Banking/coconut"
  else
    repo_path="$COCONUT_APP_REPO"
    repo_name="coconut-app"
    full_repo="Coconut-Banking/coconut-app"
  fi

  echo "Reactive mode: investigating issue in $repo_name"
  echo "Issue: $error_description"

  cd "$repo_path"
  git fetch origin main
  git checkout main
  git pull origin main

  local branch="fix/reactive-$(date +%Y%m%d-%H%M%S)"
  git checkout -b "$branch"

  local claude_output
  claude_output=$("$CLAUDE" -p "You are a senior engineer investigating a specific bug/issue in the $repo_name codebase ($full_repo).

## The Issue
$error_description

## Instructions

1. Investigate the issue. Read the relevant files, trace the code path, understand what's wrong.
2. If you can confirm the issue is real:
   a. Implement the minimum fix
   b. If this is the coconut (web) repo, write a vitest test for the fix
   c. Run validation: $([ "$repo_name" = "coconut" ] && echo "npm run typecheck && npm run lint && npm run test" || echo "npx tsc --noEmit")
   d. Commit with message: fix: {description of what was fixed}
   e. Push: git push -u origin $branch
   f. Create a PR: gh pr create --title 'fix: {title}' --body '{description of the issue and fix}'
   g. Output the PR URL on its own line like: PR_URL={url}
3. If the issue is NOT real or already fixed, explain why and do NOT create a PR.

Be precise. Fix only what's broken. Do not refactor or improve other code." \
    --dangerously-skip-permissions \
    --max-turns 80 \
    --verbose 2>&1) || true

  echo "$claude_output" > "$LOG_DIR/reactive-$repo_name-$TIMESTAMP.log"

  local pr_url
  pr_url=$(echo "$claude_output" | grep -oE 'PR_URL=https://[^ ]+' | tail -1 | cut -d= -f2-)

  if [ -n "$pr_url" ]; then
    notify_macos "Reactive fix: PR created for $repo_name"
    notify_telegram "*Bug Council (reactive)*
$repo_name: $pr_url
Issue: $error_description"
  else
    notify_macos "Reactive fix: no PR needed for $repo_name"
    notify_telegram "*Bug Council (reactive)*
$repo_name: no fix needed
Issue: $error_description"
  fi
}

# ── Run bug council for a single repo ────────────────────────────────────────
run_for_repo() {
  local name="$1"
  local full_repo="$2"
  local main_repo="$3"
  local work_dir="$4"
  local has_ci="$5"
  local claude_cmd="$6"
  local branch="fix/bug-council-$DATE_TAG"
  local label
  if [ "$name" = "coconut" ]; then label="web"; else label="mobile"; fi

  echo ""
  echo "================================================================"
  echo "  Bug Council v3: $name ($label)"
  echo "================================================================"

  bug_council_log "Pruning stale open PRs on $full_repo..."
  bug_council_prune_open_prs "$full_repo"

  # Ensure worktree parent dir exists
  mkdir -p "$(dirname "$work_dir")"

  # Ensure worktree exists and is on latest main
  if [ ! -d "$work_dir/.git" ] && [ ! -f "$work_dir/.git" ]; then
    echo "Creating worktree for $name..."
    git -C "$main_repo" worktree add "$work_dir" main 2>/dev/null || \
      git -C "$main_repo" worktree add "$work_dir" --detach origin/main
  fi

  cd "$work_dir"
  git fetch origin main
  git checkout main 2>/dev/null || git checkout --detach origin/main
  git reset --hard origin/main

  npm install --prefer-offline --no-audit 2>/dev/null || npm ci

  # Load the command file — for coconut-app, it lives in the coconut repo
  local claude_prompt
  if [ "$name" = "coconut" ]; then
    claude_prompt=$(cat "$work_dir/.claude/commands/$claude_cmd")
  else
    claude_prompt=$(cat "$COCONUT_REPO/.claude/commands/$claude_cmd")
  fi

  local prompt_extras
  prompt_extras=$(bug_council_prompt_extras "$name" "$full_repo" "$work_dir")

  echo "Starting Bug Council v3 audit for $name..."
  local claude_output
  claude_output=$("$CLAUDE" -p "$claude_prompt

$prompt_extras

Execute the Bug Council exactly as described above. This is an automated run. Do not ask for confirmation — proceed through all phases automatically.

IMPORTANT: After creating the PR, output the PR number on its own line like: PR_NUMBER=<number>
If no bugs were found and no PR was created, output: PR_NUMBER=none" \
    --dangerously-skip-permissions \
    --max-turns 200 \
    --verbose 2>&1) || true

  echo "$claude_output" > "$LOG_DIR/claude-output-$name-$TIMESTAMP.log"

  # Extract PR number
  local pr_number
  pr_number=$(echo "$claude_output" | grep -oE 'PR_NUMBER=[0-9]+' | tail -1 | cut -d= -f2)

  if [ -z "$pr_number" ]; then
    pr_number=$(gh pr list --repo "$full_repo" --head "$branch" --json number --jq '.[0].number' 2>/dev/null || true)
  fi

  if [ -z "$pr_number" ]; then
    pr_number=$(gh pr list --repo "$full_repo" --state open --json number,headRefName \
      --jq '.[] | select(.headRefName | startswith("fix/bug-council")) | .number' 2>/dev/null | head -1 || true)
  fi

  if [ -z "$pr_number" ] || [ "$pr_number" = "none" ]; then
    echo "No PR found for $name. Clean audit or failure — check logs."
    bug_council_save_state "$name" "$work_dir"
    RESULTS+=("$name ($label): clean (no bugs / no PR)")
    return
  fi

  echo "PR #$pr_number created for $name."

  if ! bug_council_gate_pr "$pr_number" "$full_repo"; then
    RESULTS+=("$name ($label): PR #$pr_number auto-closed (failed quality gate — see logs)")
    bug_council_save_state "$name" "$work_dir"
    return
  fi

  # ── Auto-resolve merge conflicts ───────────────────────────────────────────
  local mergeable
  mergeable=$(gh pr view "$pr_number" --repo "$full_repo" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")

  if [ "$mergeable" = "CONFLICTING" ]; then
    echo "PR #$pr_number has merge conflicts. Auto-resolving..."

    local current_branch
    current_branch=$(gh pr view "$pr_number" --repo "$full_repo" --json headRefName --jq '.headRefName' 2>/dev/null || echo "$branch")

    "$CLAUDE" -p "You are on branch $current_branch in the $name repo ($full_repo). PR #$pr_number has merge conflicts with main.

Resolve the merge conflicts:
1. git fetch origin main
2. git merge origin/main
3. For each conflict: prefer main for structural changes (deleted files, refactors). Keep our bug fixes only where they don't conflict with main's direction. When in doubt, take theirs.
4. Ensure NO conflict markers (<<<<<<, ======, >>>>>>) remain
5. git add all resolved files
6. git commit -m 'merge: resolve conflicts with main'
7. git push origin $current_branch

Do NOT create a new PR. Just resolve conflicts and push." \
      --dangerously-skip-permissions \
      --max-turns 50 \
      --verbose > "$LOG_DIR/merge-fix-$name-$TIMESTAMP.log" 2>&1 || true

    sleep 10
    mergeable=$(gh pr view "$pr_number" --repo "$full_repo" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")
    if [ "$mergeable" = "CONFLICTING" ]; then
      echo "WARNING: Merge conflicts still present for $name after auto-resolve attempt."
    else
      echo "Merge conflicts resolved for $name."
    fi
  fi

  # ── Poll CI ────────────────────────────────────────────────────────────────
  echo "Polling CI for PR #$pr_number..."

  if [ "$has_ci" = "no" ]; then
    echo "$name has no CI — PR ready for review."
    RESULTS+=("$name ($label): PR #$pr_number — no CI (ready for review)
https://github.com/$full_repo/pull/$pr_number")
    return
  fi

  local max_polls=60
  local poll_interval=30
  local ci_fix_attempted=0
  local ci_result="timeout"

  for i in $(seq 1 $max_polls); do
    sleep $poll_interval

    if gh pr checks "$pr_number" --repo "$full_repo" > /dev/null 2>&1; then
      echo "CI passed for $name!"
      gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**Bug Council v2 audit complete — all CI checks passed!**

@$GH_USER — This PR is ready for your review.
EOF
)"
      ci_result="passed"
      break
    fi

    local ci_status
    ci_status=$(gh pr checks "$pr_number" --repo "$full_repo" 2>&1 || true)
    if echo "$ci_status" | grep -q "fail"; then
      if [ "$ci_fix_attempted" -lt 2 ]; then
        echo "CI failed for $name. Spawning fix agent (attempt $((ci_fix_attempted + 1)))..."

        local current_branch
        current_branch=$(gh pr view "$pr_number" --repo "$full_repo" --json headRefName --jq '.headRefName' 2>/dev/null || echo "$branch")

        "$CLAUDE" -p "You are on branch $current_branch in the $name repo. PR #$pr_number has failing CI checks:

$ci_status

Fix the CI failures:
1. git checkout $current_branch
2. Run the failing checks locally to reproduce
3. Fix the issues (do NOT revert bug fixes unless they caused the failure)
4. Commit with message: fix: resolve CI failures
5. Push: git push origin $current_branch

Do NOT create a new PR." \
          --dangerously-skip-permissions \
          --max-turns 50 \
          --verbose > "$LOG_DIR/ci-fix-$name-$TIMESTAMP-$ci_fix_attempted.log" 2>&1 || true

        ci_fix_attempted=$((ci_fix_attempted + 1))
        continue
      else
        echo "CI still failing for $name after $ci_fix_attempted fix attempts."
        gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**Bug Council CI is failing after automated fix attempts.**

@$GH_USER — Please check manually.
EOF
)"
        ci_result="failing"
        fail_kind=$(bug_council_classify_pr "$pr_number" "$full_repo")
        if [ "$fail_kind" = "lockfile_only" ] || [ "$fail_kind" = "empty" ] || [ "$fail_kind" = "doc_only" ]; then
          bug_council_close_pr "$pr_number" "$full_repo" "Auto-closed: CI failed and PR failed quality gate ($fail_kind)."
        fi
        break
      fi
    fi

    echo "Poll $i/$max_polls for $name: CI still running..."
  done

  case "$ci_result" in
    passed)
      bug_council_save_state "$name" "$work_dir"
      RESULTS+=("$name ($label): PR #$pr_number — CI passing
https://github.com/$full_repo/pull/$pr_number")
      ;;
    failing)
      RESULTS+=("$name ($label): PR #$pr_number — CI failing (needs review)
https://github.com/$full_repo/pull/$pr_number")
      ;;
    timeout)
      gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**Bug Council CI timed out after 30 minutes.**

@$GH_USER — Please check manually.
EOF
)"
      RESULTS+=("$name ($label): PR #$pr_number — CI timed out
https://github.com/$full_repo/pull/$pr_number")
      ;;
  esac
}

# ── Main ─────────────────────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"

# Handle --reactive mode
if [ "${1:-}" = "--reactive" ] || [ "${1:-}" = "--reactive-repo" ]; then
  acquire_lock
  exec > >(tee "$LOG_DIR/stdout-reactive-$TIMESTAMP.log") 2> >(tee "$LOG_DIR/stderr-reactive-$TIMESTAMP.log" >&2)

  if [ "$1" = "--reactive-repo" ]; then
    run_reactive "${2:-coconut}" "${3:?Usage: $0 --reactive-repo <coconut|coconut-app> \"error description\"}"
  else
    run_reactive "coconut" "${2:?Usage: $0 --reactive \"error description\"}"
  fi
  exit 0
fi

# Full audit mode
acquire_lock

# Max runtime: 3 hours then self-kill
MAX_RUNTIME=10800
(sleep $MAX_RUNTIME && echo "TIMEOUT: Bug council exceeded ${MAX_RUNTIME}s, killing..." && kill -TERM $$ 2>/dev/null) &
WATCHDOG_PID=$!

exec > >(tee "$LOG_DIR/stdout-$TIMESTAMP.log") 2> >(tee "$LOG_DIR/stderr-$TIMESTAMP.log" >&2)

for config in "${REPO_CONFIGS[@]}"; do
  IFS='|' read -r name full_repo main_repo work_dir has_ci claude_cmd <<< "$config"
  run_for_repo "$name" "$full_repo" "$main_repo" "$work_dir" "$has_ci" "$claude_cmd" || true
done

# ── Consolidated notification ────────────────────────────────────────────────
TELEGRAM_MSG="*Bug Council v3 Complete*"
for result in "${RESULTS[@]}"; do
  TELEGRAM_MSG="$TELEGRAM_MSG

$result"
done

if [ ${#RESULTS[@]} -eq 0 ]; then
  TELEGRAM_MSG="$TELEGRAM_MSG

No bugs found in either repo."
fi

notify_macos "Bug Council finished — ${#RESULTS[@]} repo(s) processed"
notify_telegram "$TELEGRAM_MSG"

find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
