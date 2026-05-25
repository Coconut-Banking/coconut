#!/bin/bash
# Shared helpers for Bug Council runner — PR hygiene, diff gates, state files.
# Sourced by scripts/.bug-council-runner.sh (do not execute directly).

bug_council_log() { echo "[bug-council] $*"; }

# Per-repo last-audited SHA (written after a successful run with a mergeable PR or clean audit)
bug_council_state_file() {
  local name="$1"
  echo "${BUG_COUNCIL_LOG_DIR:-.bug-council-logs}/.last-successful-run-${name}"
}

bug_council_save_state() {
  local name="$1"
  local repo_path="$2"
  local f
  f=$(bug_council_state_file "$name")
  mkdir -p "$(dirname "$f")"
  git -C "$repo_path" rev-parse origin/main > "$f" 2>/dev/null || \
    git -C "$repo_path" rev-parse main > "$f" 2>/dev/null || true
}

bug_council_diff_base() {
  local name="$1"
  local f
  f=$(bug_council_state_file "$name")
  if [ -f "$f" ]; then
    cat "$f"
  else
    echo "HEAD~30"
  fi
}

# Returns newline-separated PR numbers (newest first)
bug_council_open_prs() {
  local full_repo="$1"
  gh pr list --repo "$full_repo" --state open --limit 30 \
    --json number,headRefName,createdAt,mergeable,additions,deletions \
    --jq '.[] | select(.headRefName | startswith("fix/bug-council")) | .number' 2>/dev/null || true
}

# Classify PR diff: ok | empty | lockfile_only | doc_only | conflicting
bug_council_classify_pr() {
  local pr_number="$1"
  local full_repo="$2"

  local mergeable additions deletions
  mergeable=$(gh pr view "$pr_number" --repo "$full_repo" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")
  if [ "$mergeable" = "CONFLICTING" ]; then
    echo "conflicting"
    return
  fi

  additions=$(gh pr view "$pr_number" --repo "$full_repo" --json additions --jq '.additions' 2>/dev/null || echo "0")
  deletions=$(gh pr view "$pr_number" --repo "$full_repo" --json deletions --jq '.deletions' 2>/dev/null || echo "0")
  if [ "${additions:-0}" -eq 0 ] && [ "${deletions:-0}" -eq 0 ]; then
    echo "empty"
    return
  fi

  local files_json
  files_json=$(gh pr view "$pr_number" --repo "$full_repo" --json files --jq '[.files[].path]' 2>/dev/null || echo "[]")
  if [ "$files_json" = "[]" ] || [ -z "$files_json" ]; then
    echo "empty"
    return
  fi

  # Lockfile-only: every changed file is package-lock.json
  local non_lock
  non_lock=$(echo "$files_json" | python3 -c "
import json,sys
paths=json.load(sys.stdin)
non=[p for p in paths if p not in ('package-lock.json','pnpm-lock.yaml','yarn.lock')]
print('yes' if non else 'no')
" 2>/dev/null || echo "yes")
  if [ "$non_lock" = "no" ]; then
    echo "lockfile_only"
    return
  fi

  # Doc-only: only .md / .mdc under .cursor or docs
  local has_code
  has_code=$(echo "$files_json" | python3 -c "
import json,sys
paths=json.load(sys.stdin)
code_ext=('.ts','.tsx','.js','.jsx')
for p in paths:
    if p.endswith(code_ext):
        print('yes'); sys.exit(0)
print('no')
" 2>/dev/null || echo "yes")
  if [ "$has_code" = "no" ]; then
    echo "doc_only"
    return
  fi

  # Huge lockfile churn with little real code
  local lock_lines
  lock_lines=$(gh pr view "$pr_number" --repo "$full_repo" --json files --jq \
    '[.files[] | select(.path=="package-lock.json") | .additions + .deletions] | add // 0' 2>/dev/null || echo "0")
  if [ "${lock_lines:-0}" -gt 500 ] && [ "${additions:-0}" -lt 50 ]; then
    echo "lockfile_only"
    return
  fi

  echo "ok"
}

bug_council_close_pr() {
  local pr_number="$1"
  local full_repo="$2"
  local reason="$3"
  gh pr close "$pr_number" --repo "$full_repo" --comment "$reason" 2>/dev/null || true
  bug_council_log "Closed PR #$pr_number on $full_repo: $reason"
}

# Close stale/low-value open bug-council PRs before a new audit
bug_council_prune_open_prs() {
  local full_repo="$1"
  local pr
  while IFS= read -r pr; do
    [ -z "$pr" ] && continue
    local kind
    kind=$(bug_council_classify_pr "$pr" "$full_repo")
    case "$kind" in
      empty)
        bug_council_close_pr "$pr" "$full_repo" "Auto-closed: empty PR (0 meaningful changes). Bug Council v3 will open a new PR only when there are real code fixes."
        ;;
      lockfile_only)
        bug_council_close_pr "$pr" "$full_repo" "Auto-closed: package-lock-only churn (not a product fix). Do not commit lockfile-only bug council diffs."
        ;;
      doc_only)
        bug_council_close_pr "$pr" "$full_repo" "Auto-closed: documentation/rules-only changes with no app code fixes."
        ;;
      conflicting)
        # Close conflicting PRs older than 2 days
        local created
        created=$(gh pr view "$pr" --repo "$full_repo" --json createdAt --jq '.createdAt' 2>/dev/null || echo "")
        if [ -n "$created" ]; then
          local age_days
          age_days=$(python3 -c "
from datetime import datetime, timezone
c=datetime.fromisoformat('${created}'.replace('Z','+00:00'))
print((datetime.now(timezone.utc)-c).days)
" 2>/dev/null || echo "0")
          if [ "${age_days:-0}" -ge 2 ]; then
            bug_council_close_pr "$pr" "$full_repo" "Auto-closed: merge conflicts with main for ${age_days}+ days — fixes likely already on main or superseded."
          fi
        fi
        ;;
    esac
  done < <(bug_council_open_prs "$full_repo")
}

# Keep at most one open bug-council PR (newest wins)
bug_council_dedupe_open_prs() {
  local full_repo="$1"
  local keep="${2:-}"
  local pr first=1
  while IFS= read -r pr; do
    [ -z "$pr" ] && continue
    if [ -n "$keep" ] && [ "$pr" = "$keep" ]; then
      continue
    fi
    if [ "$first" -eq 1 ] && [ -z "$keep" ]; then
      keep="$pr"
      first=0
      continue
    fi
    bug_council_close_pr "$pr" "$full_repo" "Auto-closed: duplicate bug council PR — keeping a single open PR per repo (#${keep:-$pr})."
  done < <(bug_council_open_prs "$full_repo")
}

# After audit: close PR if it fails quality gates; returns 0 if PR is good, 1 if closed/skipped
bug_council_gate_pr() {
  local pr_number="$1"
  local full_repo="$2"
  local kind
  kind=$(bug_council_classify_pr "$pr_number" "$full_repo")
  case "$kind" in
    ok)
      bug_council_dedupe_open_prs "$full_repo" "$pr_number"
      return 0
      ;;
    empty)
      bug_council_close_pr "$pr_number" "$full_repo" "Auto-closed: no code changes after audit — nothing to merge."
      return 1
      ;;
    lockfile_only)
      bug_council_close_pr "$pr_number" "$full_repo" "Auto-closed: lockfile-only diff rejected by Bug Council v3 gates."
      return 1
      ;;
    doc_only)
      bug_council_close_pr "$pr_number" "$full_repo" "Auto-closed: rules/docs-only — not worth a standalone PR."
      return 1
      ;;
    conflicting)
      bug_council_close_pr "$pr_number" "$full_repo" "Auto-closed: still conflicting with main after merge attempt."
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

bug_council_prompt_extras() {
  local name="$1"
  local full_repo="$2"
  local work_dir="$3"
  local known_fp="$COCONUT_REPO/docs/BUG_COUNCIL_FALSE_POSITIVES.md"
  local diff_base
  diff_base=$(bug_council_diff_base "$name")

  local changed_since
  changed_since=$(git -C "$work_dir" diff --name-only "$diff_base" origin/main 2>/dev/null | head -40 || true)

  cat <<EOF

---
## Bug Council v3 — Runner constraints (MANDATORY)

### Before Phase 1
1. Read known false positives: \`$known_fp\`
2. **Prioritize files changed on main since last audit** (\`$diff_base\` → \`origin/main\`):
\`\`\`
$changed_since
\`\`\`
3. Run preflight on **origin/main** for payment/auth bugs — grep the cited file before reporting

### Phase 3 — Fix only if missing on main
For each verified bug, BEFORE editing:
\`\`\`bash
git show origin/main:path/to/file | head -80   # or grep the pattern on main
\`\`\`
If main already has the fix → output **SKIP: already fixed on main** and do NOT commit.

### Phase 5 — PR rules
- **Do NOT create a PR** if: zero fix commits, only \`common-bugs.mdc\` audit-history lines, only \`package-lock.json\`, or all fixes were SKIP
- **Maximum one PR** for this repo: \`$full_repo\`
- Branch: \`fix/bug-council-$DATE_TAG\` (already created in worktree)
- After \`gh pr create\`, output exactly: \`PR_NUMBER=<n>\`
- If no PR: output exactly: \`PR_NUMBER=none\`

### Hard rejects (disprove, do not fix)
- Mobile Stripe PI body in **cents** (backend expects dollars)
- Lockfile-only commits
- Unused imports
- Re-adding removed Splitwise shadow/parity tooling (web repo only)

Worktree: $work_dir
Repo: $full_repo
EOF
}
