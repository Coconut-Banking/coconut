#!/bin/bash
# AI Fix Runner — Fetches GitHub issues labeled "ai-fix" from BOTH repos (coconut + coconut-app),
# spawns Claude Code to fix them, creates PRs, verifies CI, and sends ONE consolidated notification.
# Uses dedicated git worktrees so it never touches your main checkouts.

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Users/koushik/.local/bin:/Users/koushik/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin:$PATH"

# ── Config ──────────────────────────────────────────────────────────────────
LOCKFILE="/tmp/coconut-ai-fix.lock"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DATE_TAG=$(date +%Y%m%d)
TELEGRAM_BOT_TOKEN="8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk"
TELEGRAM_CHAT_ID="1728663117"
GH_USER="KoushikP04"
CLAUDE="$HOME/.nvm/versions/node/v24.12.0/bin/claude"

LOG_DIR="/Users/koushik/github/coconut/.ai-fix-logs"

# Repo configs: name|full_repo|main_repo_path|worktree_path|has_ci|app_type
REPO_CONFIGS=(
  "coconut|Coconut-Banking/coconut|/Users/koushik/github/coconut|/Users/koushik/github/coconut-worktrees/ai-fix|yes|nextjs"
  "coconut-app|Coconut-Banking/coconut-app|/Users/koushik/github/coconut-app|/Users/koushik/github/coconut-app-worktrees/ai-fix|yes|expo"
)

declare -a RESULTS=()

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
  pkill -TERM -P $$ 2>/dev/null || true
  sleep 1
  pkill -KILL -P $$ 2>/dev/null || true
  pgrep -f "claude.*ai-fix" | xargs kill -9 2>/dev/null || true
  jobs -p 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -f "$LOCKFILE"
  rm -rf "/Users/koushik/github/coconut-worktrees/ai-fix/.next" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Max runtime: 3 hours then self-kill (two repos sequentially) ─────────────
MAX_RUNTIME=10800
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

# ── Run AI fix for a single repo ─────────────────────────────────────────────
run_for_repo() {
  local name="$1"
  local full_repo="$2"
  local main_repo="$3"
  local work_dir="$4"
  local has_ci="$5"
  local app_type="$6"
  local branch="fix/ai-fix-$DATE_TAG"
  local label
  if [ "$name" = "coconut" ]; then label="web"; else label="mobile"; fi

  echo ""
  echo "================================================================"
  echo "  AI Fix: $name ($label)"
  echo "================================================================"

  # Ensure worktree parent dir exists
  mkdir -p "$(dirname "$work_dir")"

  # Ensure worktree exists and is on latest main
  if [ ! -d "$work_dir/.git" ] && [ ! -f "$work_dir/.git" ]; then
    echo "Creating worktree for $name..."
    git -C "$main_repo" worktree add "$work_dir" --detach origin/main 2>/dev/null || true
  fi

  cd "$work_dir"
  git fetch origin main
  git checkout main 2>/dev/null || git checkout --detach origin/main
  git reset --hard origin/main
  npm install --prefer-offline --no-audit 2>/dev/null || npm ci

  # Fetch ai-fix issues for this repo (labeled + title fallback for repos without the label)
  echo "Fetching ai-fix issues for $name..."
  local labeled_json unlabeled_json issues_json
  labeled_json=$(gh issue list \
    --repo "$full_repo" \
    --label "ai-fix" \
    --state open \
    --json number,title,body,labels,comments \
    --limit 50 2>/dev/null || echo "[]")

  # Fallback: also find issues with "Bug:" title prefix (for repos missing ai-fix label)
  unlabeled_json=$(gh issue list \
    --repo "$full_repo" \
    --state open \
    --search "Bug: in:title" \
    --json number,title,body,labels,comments \
    --limit 50 2>/dev/null || echo "[]")

  # Merge, deduplicate, filter out junk, and auto-close test/spam issues
  issues_json=$(python3 -c "
import sys, json

labeled = json.loads('''$labeled_json''')
unlabeled = json.loads('''$unlabeled_json''')

# Merge and deduplicate
seen = set()
merged = []
for issue in labeled + unlabeled:
    if issue['number'] not in seen:
        seen.add(issue['number'])
        merged.append(issue)

# Separate junk from real issues
junk_words = {'test', 'testing', 'asdf', 'hello', 'hi', 'foo', 'bar', 'try', 'trying'}
real = []
junk = []
for issue in merged:
    label_names = [l['name'].lower() for l in issue.get('labels', [])]
    if 'test' in label_names:
        junk.append(issue)
        continue
    title = (issue.get('title') or '').strip()
    if not title:
        junk.append(issue)
        continue
    # Check if description is just a test word
    desc = title.replace('Bug:', '').replace('bug:', '').strip().lower()
    if desc in junk_words:
        junk.append(issue)
        continue
    real.append(issue)

# Output both lists separated by a marker
print(json.dumps({'real': real, 'junk': junk}))
")

  # Auto-close junk/test issues
  local junk_numbers
  junk_numbers=$(echo "$issues_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for i in data.get('junk', []):
    print(i['number'])
")
  for junk_num in $junk_numbers; do
    echo "Auto-closing test/spam issue #$junk_num..."
    gh issue close "$junk_num" --repo "$full_repo" --comment "Closed by AI Fix Bot: test/spam issue." 2>/dev/null || true
  done

  # Extract real issues
  issues_json=$(echo "$issues_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data['real']))
")

  local issue_count
  issue_count=$(echo "$issues_json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

  if [ "$issue_count" -eq 0 ]; then
    echo "No ai-fix issues found for $name."
    RESULTS+=("$name ($label): no issues to fix")
    return
  fi

  echo "Found $issue_count issue(s) for $name."

  # Build prompt
  local issues_prompt
  issues_prompt=$(echo "$issues_json" | python3 -c "
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

  local fixes_keywords
  fixes_keywords=$(echo "$issues_json" | python3 -c "
import sys, json
issues = json.load(sys.stdin)
print(', '.join([f'Fixes #{i[\"number\"]}' for i in issues]))
")

  # Build verification commands based on app type
  local verify_commands
  if [ "$app_type" = "nextjs" ]; then
    verify_commands="   - npx tsc --noEmit — if type errors from your changes, fix them or revert the offending commit
   - npm run lint — fix any lint errors introduced
   - npx vitest run --reporter=verbose 2>&1 | tail -80 — if tests fail due to your changes, fix or revert"
  else
    verify_commands="   - npx tsc --noEmit — if type errors from your changes, fix them or revert the offending commit
   - npx expo config --type public — verify the Expo config is valid"
  fi

  local app_description
  if [ "$app_type" = "nextjs" ]; then
    app_description="a personal finance app (Next.js, Supabase, Clerk, Plaid, Stripe)"
  else
    app_description="a personal finance mobile app (Expo/React Native, Clerk, Stripe Terminal)"
  fi

  local prompt_file
  prompt_file=$(mktemp)
  cat > "$prompt_file" <<PROMPT_EOF
You are the AI Fix Bot for $app_description.
You have $issue_count GitHub issue(s) labeled "ai-fix" to resolve.

## Context
- These issues come from user bug reports via Telegram. They may include screenshots (as markdown image links to bug-screenshots/ in the repo) or videos.
- Issue comments may contain additional screenshots from multi-image submissions.
- Some issues may have vague descriptions — use your best judgment to interpret the bug from context and the codebase. If an issue is truly nonsensical, spam, or impossible to act on, skip it and explain why.

## Issues to Fix

$issues_prompt

## Instructions

1. Create a new branch: git checkout -b $branch

2. For each issue:
   - Read the relevant code and understand the bug
   - If there are screenshot references, use them as context for understanding the visual bug
   - Implement a minimal targeted fix — don't refactor unrelated code
   - Match existing code patterns and style
   - One commit per issue with format: fix: <description> (#<issue_number>)

3. After all fixes, run verification:
$verify_commands

4. Push the branch: git push -u origin $branch

5. Create a single PR. The title should be: fix: ai-fix bot — $issue_count bug(s) fixed ($DATE_TAG)

The PR body MUST include these exact lines near the top so GitHub auto-closes the issues on merge:
$fixes_keywords

The PR body should also include:
- A summary table with columns: #, Issue, Fix Description, Files Changed, Lines Changed (one row per issue, issue number linked as #N)
- A Verification section showing tsc, eslint, vitest all pass (or just tsc for mobile)
- A Skipped Issues section (list any skipped issues and why, or "None")
- Footer: Generated by AI Fix Bot via Claude Code

6. After creating the PR, output the PR number on its own line like: PR_NUMBER=<number>

IMPORTANT: Do NOT push to main. Do NOT auto-merge. Create the PR and stop.
PROMPT_EOF
  local claude_prompt
  claude_prompt=$(cat "$prompt_file")
  rm -f "$prompt_file"

  # Run Claude
  echo "Spawning Claude Code to fix $name issues..."
  local claude_output
  claude_output=$("$CLAUDE" -p "$claude_prompt" \
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
    echo "ERROR: Could not find PR number for $name."
    RESULTS+=("$name ($label): failed — no PR created")
    return
  fi

  echo "PR #$pr_number created for $name. Polling CI..."

  # Skip CI polling for repos without CI
  if [ "$has_ci" = "no" ]; then
    echo "$name has no CI — PR ready for review."
    RESULTS+=("$name ($label): PR #$pr_number — $issue_count issue(s) fixed, no CI (ready for review)
https://github.com/$full_repo/pull/$pr_number")
    return
  fi

  # Poll CI
  local max_polls=60
  local poll_interval=30
  local ci_fix_attempted=0
  local ci_result="timeout"

  for i in $(seq 1 $max_polls); do
    sleep $poll_interval

    if gh pr checks "$pr_number" --repo "$full_repo" > /dev/null 2>&1; then
      echo "CI passed for $name!"
      gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**All CI checks passed!**

@$GH_USER — This PR is ready for your review.

**Issues addressed:** $fixes_keywords

Please review and merge when ready. The linked issues will auto-close on merge.
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

        "$CLAUDE" -p "You are on branch $branch in the $name repo. The PR #$pr_number has failing CI checks. Here is the CI output:

$ci_status

Fix the CI failures:
1. Run the failing checks locally to reproduce
2. Fix the issues
3. Commit with message: fix: resolve CI failures
4. Push to the branch: git push origin $branch

Do NOT create a new PR. Just fix and push." \
          --dangerously-skip-permissions \
          --max-turns 50 \
          --verbose > "$LOG_DIR/ci-fix-$name-$TIMESTAMP-$ci_fix_attempted.log" 2>&1 || true

        ci_fix_attempted=$((ci_fix_attempted + 1))
        continue
      else
        echo "CI still failing for $name after $ci_fix_attempted fix attempts."
        gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**CI is failing after automated fix attempts.**

@$GH_USER — Please check manually.

**Issues addressed:** $fixes_keywords
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
      RESULTS+=("$name ($label): PR #$pr_number — $issue_count issue(s) fixed, CI passing
https://github.com/$full_repo/pull/$pr_number")
      ;;
    failing)
      RESULTS+=("$name ($label): PR #$pr_number — $issue_count issue(s) fixed, CI failing
https://github.com/$full_repo/pull/$pr_number")
      ;;
    timeout)
      gh pr comment "$pr_number" --repo "$full_repo" --body "$(cat <<EOF
**CI timed out after 30 minutes.**

@$GH_USER — CI did not complete in time. Please check manually.
EOF
)"
      RESULTS+=("$name ($label): PR #$pr_number — $issue_count issue(s) fixed, CI timed out
https://github.com/$full_repo/pull/$pr_number")
      ;;
  esac
}

# ── Main: Process repos sequentially ─────────────────────────────────────────
for config in "${REPO_CONFIGS[@]}"; do
  IFS='|' read -r name full_repo main_repo work_dir has_ci app_type <<< "$config"
  run_for_repo "$name" "$full_repo" "$main_repo" "$work_dir" "$has_ci" "$app_type" || true
done

# ── Send ONE consolidated notification ───────────────────────────────────────
TELEGRAM_MSG="*AI Fix Bot Complete*"
for result in "${RESULTS[@]}"; do
  TELEGRAM_MSG="$TELEGRAM_MSG

$result"
done

if [ ${#RESULTS[@]} -eq 0 ]; then
  TELEGRAM_MSG="$TELEGRAM_MSG

No issues to fix in either repo."
fi

notify_macos "AI Fix Bot finished — ${#RESULTS[@]} repo(s) processed"
notify_telegram "$TELEGRAM_MSG"

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
