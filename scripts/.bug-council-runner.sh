#!/bin/bash
# Bug Council Runner — Runs the daily bug council audit for BOTH repos (coconut + coconut-app),
# polls CI, and sends ONE consolidated Telegram notification.
# Uses dedicated git worktrees so it never touches your main checkouts.

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/Users/koushik/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin:$PATH"

# ── Config ──────────────────────────────────────────────────────────────────
LOCKFILE="/tmp/coconut-bug-council.lock"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_TAG=$(date +%Y%m%d)
TELEGRAM_BOT_TOKEN="8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk"
TELEGRAM_CHAT_ID="1728663117"
GH_USER="KoushikP04"
CLAUDE="$HOME/.nvm/versions/node/v24.12.0/bin/claude"

# Log to the main coconut repo's log dir
LOG_DIR="/Users/koushik/github/coconut/.bug-council-logs"

# Repo configs: name|full_repo|main_repo_path|worktree_path|has_ci|claude_command
REPO_CONFIGS=(
  "coconut|Coconut-Banking/coconut|/Users/koushik/github/coconut|/Users/koushik/github/coconut-worktrees/bug-council|yes|bug-council.md"
  "coconut-app|Coconut-Banking/coconut-app|/Users/koushik/github/coconut-app|/Users/koushik/github/coconut-app-worktrees/bug-council|yes|bug-council-mobile.md"
)

# Results array — populated per repo
declare -a RESULTS=()

# ── Prevent concurrent runs ─────────────────────────────────────────────────
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Another bug council run is still active (PID $LOCK_PID). Skipping."
    exit 0
  fi
  rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"

# ── Cleanup trap: kill entire process tree + remove lockfile ─────────────────
cleanup() {
  echo "Cleaning up..."
  pkill -TERM -P $$ 2>/dev/null || true
  sleep 1
  pkill -KILL -P $$ 2>/dev/null || true
  pgrep -f "claude.*bug-council" | xargs kill -9 2>/dev/null || true
  jobs -p 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -f "$LOCKFILE"
  # Clean up build artifacts
  rm -rf "/Users/koushik/github/coconut-worktrees/bug-council/.next" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Max runtime: 3 hours then self-kill (two repos sequentially) ─────────────
MAX_RUNTIME=10800
(sleep $MAX_RUNTIME && echo "TIMEOUT: Bug council exceeded ${MAX_RUNTIME}s, killing..." && kill -TERM $$ 2>/dev/null) &
WATCHDOG_PID=$!

mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_DIR/stdout-$TIMESTAMP.log") 2> >(tee "$LOG_DIR/stderr-$TIMESTAMP.log" >&2)

# ── Helpers ─────────────────────────────────────────────────────────────────
notify_macos() {
  osascript -e "display notification \"$1\" with title \"Coconut Bug Council\" sound name \"Glass\"" 2>/dev/null || true
}

notify_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d parse_mode="Markdown" \
    -d text="$1" > /dev/null 2>&1 || true
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
  echo "  Bug Council: $name ($label)"
  echo "================================================================"

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

  # Install deps (coconut uses npm, coconut-app uses npm too)
  npm install --prefer-offline --no-audit 2>/dev/null || npm ci

  # Run Claude with the appropriate command file
  # For coconut-app, the command file is in the coconut repo, so we need to provide it inline
  local claude_prompt
  if [ "$name" = "coconut" ]; then
    claude_prompt=$(cat "$work_dir/.claude/commands/$claude_cmd")
  else
    # coconut-app uses the command from the main coconut repo
    claude_prompt=$(cat "/Users/koushik/github/coconut/.claude/commands/$claude_cmd")
  fi

  echo "Starting Bug Council audit for $name..."
  local claude_output
  claude_output=$("$CLAUDE" -p "$claude_prompt

Execute the Bug Council skill exactly as described above. This is an automated daily run. Do not ask for confirmation — proceed through all phases automatically.

IMPORTANT: After creating the PR, output the PR number on its own line like: PR_NUMBER=<number>" \
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
    pr_number=$(gh pr list --repo "$full_repo" --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("fix/bug-council")) | .number' 2>/dev/null | head -1 || true)
  fi

  if [ -z "$pr_number" ]; then
    echo "No PR found for $name. May have found no bugs or failed."
    RESULTS+=("$name ($label): no issues found")
    return
  fi

  echo "PR #$pr_number created for $name."

  # ── Auto-resolve merge conflicts ──────────────────────────────────────────
  local mergeable
  mergeable=$(gh pr view "$pr_number" --repo "$full_repo" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")

  if [ "$mergeable" = "CONFLICTING" ]; then
    echo "PR #$pr_number has merge conflicts. Auto-resolving..."

    local current_branch
    current_branch=$(gh pr view "$pr_number" --repo "$full_repo" --json headRefName --jq '.headRefName' 2>/dev/null || echo "$branch")

    "$CLAUDE" -p "You are on branch $current_branch in the $name repo ($full_repo). PR #$pr_number has merge conflicts with main.

Resolve the merge conflicts:
1. git fetch origin main (or upstream main)
2. git merge origin/main (or upstream/main depending on remote setup)
3. For each conflict: prefer upstream/main for structural changes (deleted files, refactors). Keep our bug fixes only where they don't conflict with main's direction. When in doubt, take theirs.
4. Make sure there are NO conflict markers (<<<<<<, ======, >>>>>>) left in any file
5. git add all resolved files
6. git commit -m 'merge: resolve conflicts with main'
7. git push origin $current_branch

Do NOT create a new PR. Just resolve conflicts and push." \
      --dangerously-skip-permissions \
      --max-turns 50 \
      --verbose > "$LOG_DIR/merge-fix-$name-$TIMESTAMP.log" 2>&1 || true

    # Re-check mergeable status
    sleep 10
    mergeable=$(gh pr view "$pr_number" --repo "$full_repo" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")
    if [ "$mergeable" = "CONFLICTING" ]; then
      echo "WARNING: Merge conflicts still present for $name after auto-resolve attempt."
    else
      echo "Merge conflicts resolved for $name."
    fi
  fi

  echo "Polling CI for PR #$pr_number..."

  # Poll CI (skip for repos without CI)
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
**Bug Council audit complete — all CI checks passed!**

@$GH_USER — This PR is ready for your review.

Please review and merge when ready.
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
1. Make sure you are on the correct branch: git checkout $current_branch
2. Run the failing checks locally to reproduce
3. Fix the issues
4. Commit with message: fix: resolve CI failures
5. Push: git push origin $current_branch

Do NOT create a new PR. Just fix and push." \
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
        break
      fi
    fi

    echo "Poll $i/$max_polls for $name: CI still running..."
  done

  case "$ci_result" in
    passed)
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

# ── Main: Process repos sequentially ─────────────────────────────────────────
for config in "${REPO_CONFIGS[@]}"; do
  IFS='|' read -r name full_repo main_repo work_dir has_ci claude_cmd <<< "$config"
  run_for_repo "$name" "$full_repo" "$main_repo" "$work_dir" "$has_ci" "$claude_cmd" || true
done

# ── Send ONE consolidated notification ───────────────────────────────────────
TELEGRAM_MSG="*Bug Council Complete*"
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

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
