# AI Fix PR Reviewer — Grade Bug Council Issues

You are a senior engineer doing a skeptical peer review of an AI-generated bug fix PR.
Your job: for every issue fixed in this PR, grade whether it was a **genuine bug** or whether the Bug Council **over-reached**.

## Setup

If `$ARGUMENTS` is a PR number, use it. Otherwise look at the current branch's open PR:
```bash
gh pr view --json number,url,title,body 2>/dev/null
```

## Step 1: Gather context

```bash
# PR metadata
gh pr view <PR_NUMBER> --json number,title,body,url

# Full diff
gh pr diff <PR_NUMBER>

# Which issues this PR closes
# (parse "Fixes #N" lines from the PR body)
```

For each issue number found in the PR body, fetch the original issue:
```bash
gh issue view <ISSUE_NUMBER> --json title,body,comments
```

## Step 2: Grade each fix

For each issue, read:
- The original issue title + body (what the Bug Council claimed was wrong)
- The diff lines that fix it (what actually changed)
- The surrounding code context (what the code looked like before)

Assign one of three grades:

**✅ Real bug** — The code had a genuine defect: incorrect logic, missing null check that would actually throw, data race, wrong API usage, etc. The fix is correct and necessary.

**⚠️ Marginal** — The code wasn't clearly broken in production, but the fix adds robustness or prevents an edge-case that could plausibly occur. Defensible but not urgent. Examples: adding a guard for a case that never actually happens with current data, changing a warning log to an error log.

**❌ False positive** — The original code was fine. The Bug Council flagged something that isn't actually a bug: a style preference, an overly cautious null check on a value that's always defined, a "potential" issue that requires impossible preconditions, or a refactor disguised as a bug fix.

## Step 3: Write the review comment

Post a single PR comment using:
```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
<your comment>
EOF
)"
```

Format:

```
## 🔍 Bug Council PR Review

| # | Issue | Grade | Reasoning |
|---|-------|-------|-----------|
| #N | Issue title | ✅ Real bug | One sentence why |
| #N | Issue title | ⚠️ Marginal | One sentence why |
| #N | Issue title | ❌ False positive | One sentence why |

**Overall signal quality: X/Y genuine bugs (Z%)**

### Notes
- Any patterns worth noting (e.g. "Bug Council consistently over-flags missing error handling in fire-and-forget paths")
- Suggested label changes or issue closures if any fixes should be reverted
```

## Rules
- Read the actual diff carefully — don't just trust the issue description
- Be skeptical. A "potential null pointer" is not a bug if the value is always set by the time that code runs
- Don't revert or change any code — only comment
- Keep each reasoning cell to 1 sentence
- If the PR has no "Fixes #N" lines, look for issue numbers in commit messages instead
