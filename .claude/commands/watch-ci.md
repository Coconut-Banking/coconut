# CI Watcher — Monitor PR and Fix Failures

You are a CI watcher agent. Your job is to monitor a pull request's CI checks, and if anything fails, diagnose and fix it with new commits until CI is green.

## Step 1: Identify the PR

If `$ARGUMENTS` is provided, use it as the PR number. Otherwise detect from the current branch:

```bash
# Get PR number from current branch
gh pr view --json number,headRefName,url 2>/dev/null
```

Save the PR number, branch name, and URL.

## Step 2: Wait for CI to complete

Poll `gh pr checks` every 30 seconds until all checks have a conclusive result (not `pending` or `queued`). Maximum wait: 15 minutes.

```bash
gh pr checks <PR_NUMBER> 2>&1
```

A check is conclusive when its state is `pass`, `fail`, or `error` — not `pending` or `queued`.

**If all checks pass → report success and stop. You are done.**

## Step 3: Diagnose failures

If any check failed, fetch the details:

```bash
# Get check names and states
gh pr checks <PR_NUMBER> --json name,state,detailsUrl 2>/dev/null

# For Vercel: get the deployment logs via gh
gh pr view <PR_NUMBER> --json statusCheckRollup 2>/dev/null
```

Also run the validation suite locally to reproduce the failure before touching code:

```bash
npm run typecheck 2>&1 | tail -40
npm run lint 2>&1 | tail -40
npm run test 2>&1 | tail -40
npm run build 2>&1 | tail -60
```

Identify which command(s) are failing and what the exact errors are.

## Step 4: Fix the failures

**Rules:**
- Fix ONLY what is failing. Do not refactor, clean up, or improve unrelated code.
- Match existing patterns in the codebase.
- If a fix is non-obvious, add a brief comment explaining why.
- Never modify `.env.local` or commit secrets.
- Never use `--no-verify` or skip hooks.

Common failure types and how to handle them:

**TypeScript errors**: Read the file at the reported line, understand the type mismatch, fix the type. If the error is in a generated file (`.next/types/`), check if it's pre-existing by running typecheck on `main`:
```bash
git stash && npm run typecheck 2>&1 | tail -20 && git stash pop
```
Pre-existing errors on main can be ignored.

**Lint errors**: Run `npm run lint` to see exact rule violations. Fix the code — do not disable lint rules unless the violation is a false positive.

**Test failures**: Read the failing test and the code it tests. Fix the code (not the test) unless the test is clearly wrong.

**Build errors**: Usually caused by missing imports, bad dynamic imports, or module resolution issues. Read the full build output carefully.

## Step 5: Commit and push

Stage only the files you changed:

```bash
git add <specific files>
git commit -m "fix: <description of what was broken and how it was fixed>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin <branch>
```

## Step 6: Repeat

Go back to Step 2. Poll CI again. Keep iterating until all checks pass or you have made 5 fix attempts without progress (at which point report the remaining failures clearly and stop).

## Final report

When done, output:
- ✅ or ❌ for each CI check
- A summary of what was fixed (if anything)
- The PR URL
