#!/bin/bash
# Bug Council Runner — Runs the daily bug council audit, polls CI, and notifies when ready.
# Uses a dedicated git worktree so it never touches your main checkout.

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/Users/koushik/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin:$PATH"

# ── Config ──────────────────────────────────────────────────────────────────
REPO="Coconut-Banking/coconut"
MAIN_REPO="/Users/koushik/github/coconut"
WORK_DIR="/Users/koushik/github/coconut-worktrees/bug-council"
LOG_DIR="$MAIN_REPO/.bug-council-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_TAG=$(date +%Y%m%d)
BRANCH="fix/bug-council-$DATE_TAG"
TELEGRAM_BOT_TOKEN="8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk"
TELEGRAM_CHAT_ID="1728663117"
GH_USER="KoushikP04"
CLAUDE="$HOME/.nvm/versions/node/v24.12.0/bin/claude"

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

# ── Step 1: Ensure worktree exists and is on latest main ────────────────────
if [ ! -d "$WORK_DIR/.git" ] && [ ! -f "$WORK_DIR/.git" ]; then
  echo "Creating worktree..."
  git -C "$MAIN_REPO" worktree add "$WORK_DIR" main 2>/dev/null || \
    git -C "$MAIN_REPO" worktree add "$WORK_DIR" --detach origin/main
fi

cd "$WORK_DIR"
git fetch origin main
git checkout main 2>/dev/null || git checkout --detach origin/main
git reset --hard origin/main
npm install --prefer-offline --no-audit 2>/dev/null || npm ci

# ── Step 2: Run Bug Council ────────────────────────────────────────────────
echo "Starting Bug Council audit..."

CLAUDE_OUTPUT=$("$CLAUDE" -p "$(cat .claude/commands/bug-council.md)

Execute the Bug Council skill exactly as described above. This is an automated daily run. Do not ask for confirmation — proceed through all phases automatically.

IMPORTANT: After creating the PR, output the PR number on its own line like: PR_NUMBER=<number>" \
  --dangerously-skip-permissions \
  --max-turns 200 \
  --verbose 2>&1) || true

echo "$CLAUDE_OUTPUT" > "$LOG_DIR/claude-output-$TIMESTAMP.log"

# ── Step 3: Extract PR number ──────────────────────────────────────────────
PR_NUMBER=$(echo "$CLAUDE_OUTPUT" | grep -oE 'PR_NUMBER=[0-9]+' | tail -1 | cut -d= -f2)

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr list --repo "$REPO" --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)
fi

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr list --repo "$REPO" --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("fix/bug-council")) | .number' 2>/dev/null | head -1 || true)
fi

if [ -z "$PR_NUMBER" ]; then
  echo "No PR found. Bug council may have found no bugs or failed."
  notify_telegram "Bug Council finished but no PR was created. Either no bugs found or an error occurred. Check logs."
  exit 0
fi

echo "PR #$PR_NUMBER created. Polling CI..."

# ── Step 4: Poll CI ────────────────────────────────────────────────────────
MAX_POLLS=60
POLL_INTERVAL=30
CI_FIX_ATTEMPTED=0
for i in $(seq 1 $MAX_POLLS); do
  sleep $POLL_INTERVAL

  if gh pr checks "$PR_NUMBER" --repo "$REPO" > /dev/null 2>&1; then
    echo "CI passed!"

    gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$(cat <<EOF
**Bug Council audit complete — all CI checks passed!**

@$GH_USER — This PR is ready for your review.

Please review and merge when ready.
EOF
)"

    notify_macos "Bug Council PR #$PR_NUMBER — CI passed!"
    notify_telegram "✅ *Bug Council PR #$PR_NUMBER — CI passed!*
Ready for your review.
https://github.com/$REPO/pull/$PR_NUMBER"
    exit 0
  fi

  CI_STATUS=$(gh pr checks "$PR_NUMBER" --repo "$REPO" 2>&1 || true)
  if echo "$CI_STATUS" | grep -q "fail"; then
    if [ "$CI_FIX_ATTEMPTED" -lt 2 ]; then
      echo "CI failed. Spawning fix agent (attempt $((CI_FIX_ATTEMPTED + 1)))..."

      CURRENT_BRANCH=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefName --jq '.headRefName' 2>/dev/null || echo "$BRANCH")

      "$CLAUDE" -p "You are on branch $CURRENT_BRANCH in the Coconut repo. PR #$PR_NUMBER has failing CI checks:

$CI_STATUS

Fix the CI failures:
1. Make sure you are on the correct branch: git checkout $CURRENT_BRANCH
2. Run the failing checks locally to reproduce
3. Fix the issues
4. Commit with message: fix: resolve CI failures
5. Push: git push origin $CURRENT_BRANCH

Do NOT create a new PR. Just fix and push." \
        --dangerously-skip-permissions \
        --max-turns 50 \
        --verbose > "$LOG_DIR/ci-fix-$TIMESTAMP-$CI_FIX_ATTEMPTED.log" 2>&1 || true

      CI_FIX_ATTEMPTED=$((CI_FIX_ATTEMPTED + 1))
      echo "CI fix attempted. Re-polling..."
      continue
    else
      echo "CI still failing after $CI_FIX_ATTEMPTED fix attempts."

      gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$(cat <<EOF
**Bug Council CI is failing after automated fix attempts.**

@$GH_USER — Please check manually.
EOF
)"

      notify_macos "Bug Council PR #$PR_NUMBER — CI failing"
      notify_telegram "❌ *Bug Council PR #$PR_NUMBER — CI still failing*
Needs manual intervention.
https://github.com/$REPO/pull/$PR_NUMBER"
      exit 1
    fi
  fi

  echo "Poll $i/$MAX_POLLS: CI still running..."
done

# Timed out
echo "CI polling timed out after 30 minutes."
gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$(cat <<EOF
**Bug Council CI timed out after 30 minutes.**

@$GH_USER — Please check manually.
EOF
)"

notify_macos "Bug Council PR #$PR_NUMBER — CI timed out"
notify_telegram "⏰ *Bug Council PR #$PR_NUMBER — CI timed out*
Please check manually.
https://github.com/$REPO/pull/$PR_NUMBER"

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
