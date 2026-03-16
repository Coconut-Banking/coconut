#!/bin/bash
# AI Fix Runner — Fetches GitHub issues labeled "ai-fix", spawns Claude Code to fix them,
# creates a single daily PR, verifies CI, and notifies via macOS + Telegram + GitHub.
# Uses a dedicated git worktree so it never touches your main checkout.

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Users/koushik/.local/bin:/Users/koushik/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin:$PATH"

# ── Config ──────────────────────────────────────────────────────────────────
REPO="Coconut-Banking/coconut"
MAIN_REPO="/Users/koushik/github/coconut"
WORK_DIR="/Users/koushik/github/coconut-worktrees/ai-fix"
LOG_DIR="$MAIN_REPO/.ai-fix-logs"
LOCKFILE="/tmp/coconut-ai-fix.lock"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_TAG=$(date +%Y%m%d)
BRANCH="fix/ai-fix-$DATE_TAG"
TELEGRAM_BOT_TOKEN="8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk"
TELEGRAM_CHAT_ID="1728663117"
GH_USER="KoushikP04"

# ── Prevent concurrent runs ─────────────────────────────────────────────────
if [ -f "$LOCKFILE" ]; then
  LOCK_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Another ai-fix run is still active (PID $LOCK_PID). Skipping."
    exit 0
  fi
  rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"

# ── Cleanup trap: kill entire process tree + remove lockfile ─────────────────
cleanup() {
  echo "Cleaning up..."
  # Kill entire process tree (grandchildren too) — not just direct children
  pkill -TERM -P $$ 2>/dev/null || true
  sleep 1
  pkill -KILL -P $$ 2>/dev/null || true
  # Kill any claude processes started by this script
  pgrep -f "claude.*ai-fix" | xargs kill -9 2>/dev/null || true
  jobs -p 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -f "$LOCKFILE"
  # Clean up build artifacts to free disk
  rm -rf "$WORK_DIR/.next" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Max runtime: 2 hours then self-kill ─────────────────────────────────────
MAX_RUNTIME=7200
(sleep $MAX_RUNTIME && echo "TIMEOUT: AI fix exceeded ${MAX_RUNTIME}s, killing..." && kill -TERM $$ 2>/dev/null) &
WATCHDOG_PID=$!

mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_DIR/stdout-$TIMESTAMP.log") 2> >(tee "$LOG_DIR/stderr-$TIMESTAMP.log" >&2)

# ── Helpers ─────────────────────────────────────────────────────────────────
notify_macos() {
  osascript -e "display notification \"$1\" with title \"Coconut AI Fix\" sound name \"Glass\"" 2>/dev/null || true
}

notify_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d parse_mode="Markdown" \
    -d text="$1" > /dev/null 2>&1 || true
}

notify_all() {
  notify_macos "$1"
  notify_telegram "$2"
}

# ── Step 1: Ensure worktree exists and is on latest main ────────────────────
if [ ! -d "$WORK_DIR/.git" ] && [ ! -f "$WORK_DIR/.git" ]; then
  echo "Creating worktree..."
  git -C "$MAIN_REPO" worktree add "$WORK_DIR" --detach origin/main 2>/dev/null || true
fi

cd "$WORK_DIR"
git fetch origin main
git checkout main 2>/dev/null || git checkout --detach origin/main
git reset --hard origin/main
npm install --prefer-offline --no-audit 2>/dev/null || npm ci

# ── Step 2: Fetch ai-fix issues (exclude "test" label) ─────────────────────
echo "Fetching ai-fix issues..."
ISSUES_JSON=$(gh issue list \
  --repo "$REPO" \
  --label "ai-fix" \
  --state open \
  --json number,title,body,labels,comments \
  --limit 50)

# Filter out issues with "test" label and issues with no title
ISSUES_JSON=$(echo "$ISSUES_JSON" | python3 -c "
import sys, json
issues = json.load(sys.stdin)
filtered = []
for issue in issues:
    label_names = [l['name'].lower() for l in issue.get('labels', [])]
    if 'test' in label_names:
        continue
    title = (issue.get('title') or '').strip()
    if not title:
        continue
    filtered.append(issue)
print(json.dumps(filtered))
")

ISSUE_COUNT=$(echo "$ISSUES_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [ "$ISSUE_COUNT" -eq 0 ]; then
  echo "No ai-fix issues found. Exiting."
  exit 0
fi

echo "Found $ISSUE_COUNT issue(s) to fix."

# ── Step 3: Build prompt for Claude ────────────────────────────────────────
ISSUES_PROMPT=$(echo "$ISSUES_JSON" | python3 -c "
import sys, json
issues = json.load(sys.stdin)
lines = []
for i in issues:
    num = i['number']
    title = i['title']
    body = (i.get('body') or 'No description provided.').strip()
    lines.append(f'### Issue #{num}: {title}')
    lines.append(f'{body}')
    comments = i.get('comments', [])
    if comments:
        for c in comments:
            cbody = (c.get('body') or '').strip()
            if cbody:
                lines.append(f'**Additional context (comment):** {cbody}')
    lines.append('')
print('\n'.join(lines))
")

FIXES_KEYWORDS=$(echo "$ISSUES_JSON" | python3 -c "
import sys, json
issues = json.load(sys.stdin)
print(', '.join([f'Fixes #{i[\"number\"]}' for i in issues]))
")

PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<PROMPT_EOF
You are the AI Fix Bot for a personal finance app (Next.js, Supabase, Clerk, Plaid, Stripe).
You have $ISSUE_COUNT GitHub issue(s) labeled "ai-fix" to resolve.

## Context
- These issues come from user bug reports via Telegram. They may include screenshots (as markdown image links to bug-screenshots/ in the repo) or videos.
- Issue comments may contain additional screenshots from multi-image submissions.
- Some issues may have vague descriptions — use your best judgment to interpret the bug from context and the codebase. If an issue is truly nonsensical, spam, or impossible to act on, skip it and explain why.

## Issues to Fix

$ISSUES_PROMPT

## Instructions

1. Create a new branch: git checkout -b $BRANCH

2. For each issue:
   - Read the relevant code and understand the bug
   - If there are screenshot references, use them as context for understanding the visual bug
   - Implement a minimal targeted fix — don't refactor unrelated code
   - Match existing code patterns and style
   - One commit per issue with format: fix: <description> (#<issue_number>)

3. After all fixes, run verification:
   - npx tsc --noEmit — if type errors from your changes, fix them or revert the offending commit
   - npm run lint — fix any lint errors introduced
   - npx vitest run --reporter=verbose 2>&1 | tail -80 — if tests fail due to your changes, fix or revert

4. Push the branch: git push -u origin $BRANCH

5. Create a single PR. The title should be: fix: ai-fix bot — $ISSUE_COUNT bug(s) fixed ($DATE_TAG)

The PR body MUST include these exact lines near the top so GitHub auto-closes the issues on merge:
$FIXES_KEYWORDS

The PR body should also include:
- A summary table with columns: #, Issue, Fix Description, Files Changed, Lines Changed (one row per issue, issue number linked as #N)
- A Verification section showing tsc, eslint, vitest all pass
- A Skipped Issues section (list any skipped issues and why, or "None")
- Footer: Generated by AI Fix Bot via Claude Code

6. After creating the PR, output the PR number on its own line like: PR_NUMBER=<number>

IMPORTANT: Do NOT push to main. Do NOT auto-merge. Create the PR and stop.
PROMPT_EOF
CLAUDE_PROMPT=$(cat "$PROMPT_FILE")
rm -f "$PROMPT_FILE"

# ── Step 4: Run Claude Code ────────────────────────────────────────────────
echo "Spawning Claude Code to fix issues..."

ISSUES_LIST=$(echo "$ISSUES_JSON" | python3 -c "
import sys, json
issues = json.load(sys.stdin)
for i in issues:
    print(f'  - #{i[\"number\"]}: {i[\"title\"][:60]}')
")

notify_all "AI Fix Bot started — $ISSUE_COUNT issue(s)" "🔧 *AI Fix Bot started*
$ISSUE_COUNT issue(s) to fix:
$ISSUES_LIST"

CLAUDE_OUTPUT=$("$HOME/.nvm/versions/node/v24.12.0/bin/claude" -p "$CLAUDE_PROMPT" \
  --dangerously-skip-permissions \
  --max-turns 200 \
  --verbose 2>&1) || true

echo "$CLAUDE_OUTPUT" > "$LOG_DIR/claude-output-$TIMESTAMP.log"

# ── Step 5: Extract PR number and poll CI ──────────────────────────────────
PR_NUMBER=$(echo "$CLAUDE_OUTPUT" | grep -oE 'PR_NUMBER=[0-9]+' | tail -1 | cut -d= -f2)

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr list --repo "$REPO" --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)
fi

if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: Could not find PR number. Claude may have failed to create the PR."
  notify_all "AI Fix Bot failed — no PR created" "❌ *AI Fix Bot failed*
Could not create PR. Check logs."
  exit 1
fi

echo "PR #$PR_NUMBER created. Polling CI..."

# Poll CI for up to 30 minutes
MAX_POLLS=60
POLL_INTERVAL=30
CI_FIX_ATTEMPTED=0
for i in $(seq 1 $MAX_POLLS); do
  sleep $POLL_INTERVAL

  if gh pr checks "$PR_NUMBER" --repo "$REPO" > /dev/null 2>&1; then
    echo "CI passed!"

    gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$(cat <<EOF
**All CI checks passed!**

@$GH_USER — This PR is ready for your review.

**Issues addressed:** $FIXES_KEYWORDS

Please review and merge when ready. The linked issues will auto-close on merge.
EOF
)"

    notify_all "PR #$PR_NUMBER — CI passed! Ready for review" "✅ *PR #$PR_NUMBER — CI passed!*
Ready for your review.
https://github.com/$REPO/pull/$PR_NUMBER"
    exit 0
  fi

  CI_STATUS=$(gh pr checks "$PR_NUMBER" --repo "$REPO" 2>&1 || true)
  if echo "$CI_STATUS" | grep -q "fail"; then
    if [ "$CI_FIX_ATTEMPTED" -lt 2 ]; then
      echo "CI failed. Spawning fix agent (attempt $((CI_FIX_ATTEMPTED + 1)))..."

      CI_FIX_PROMPT="You are on branch $BRANCH in the Coconut repo. The PR #$PR_NUMBER has failing CI checks. Here is the CI output:

$CI_STATUS

Fix the CI failures:
1. Run the failing checks locally to reproduce
2. Fix the issues
3. Commit with message: fix: resolve CI failures
4. Push to the branch: git push origin $BRANCH

Do NOT create a new PR. Just fix and push."

      "$HOME/.nvm/versions/node/v24.12.0/bin/claude" -p "$CI_FIX_PROMPT" \
        --dangerously-skip-permissions \
        --max-turns 50 \
        --verbose > "$LOG_DIR/ci-fix-$TIMESTAMP-$CI_FIX_ATTEMPTED.log" 2>&1 || true

      CI_FIX_ATTEMPTED=$((CI_FIX_ATTEMPTED + 1))
      echo "CI fix attempted. Re-polling..."
      continue
    else
      echo "CI still failing after $CI_FIX_ATTEMPTED fix attempts."
      gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$(cat <<EOF
**CI is failing after automated fix attempts.**

@$GH_USER — Please check manually.

**Issues addressed:** $FIXES_KEYWORDS
EOF
)"
      notify_all "PR #$PR_NUMBER — CI failing" "❌ *PR #$PR_NUMBER — CI still failing*
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
**CI timed out after 30 minutes.**

@$GH_USER — CI did not complete in time. Please check manually.
EOF
)"

notify_all "PR #$PR_NUMBER — CI timed out" "⏰ *PR #$PR_NUMBER — CI timed out*
Please check manually.
https://github.com/$REPO/pull/$PR_NUMBER"

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
