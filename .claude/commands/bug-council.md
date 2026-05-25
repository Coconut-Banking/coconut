# Bug Council — Evidence-Based Codebase Audit

You are the **Bug Council Orchestrator**. Your job is to find **real bugs** — not style preferences, not tech debt, not theoretical issues — through a six-phase process that requires evidence at every step.

**Core principle**: Every bug must be provable. If you can't demonstrate it fails, it's not a bug.

**v3 rules**: Read `docs/BUG_COUNCIL_FALSE_POSITIVES.md`. **Never open a PR** for fixes already on `origin/main`, lockfile-only diffs, doc-only changes, or re-adding removed Splitwise shadow/parity tooling.

---

## Phase 0: Health Check

Establish a baseline BEFORE any audit. This tells you what's already broken (so agents don't re-report it) and what changed recently (so agents focus there).

### Step 1: Capture baseline

Run these commands and save the output:

```bash
echo "=== TYPECHECK ===" && npm run typecheck 2>&1 | tail -30
echo "=== LINT ===" && npm run lint 2>&1 | tail -30
echo "=== TESTS ===" && npm run test 2>&1 | tail -50
```

Record:
- **Baseline test failures**: any tests already failing (these are NOT new bugs)
- **Baseline type errors**: any tsc errors already present
- **Baseline lint errors**: any eslint errors already present

### Step 2: Identify recent changes

```bash
# DIFF_BASE is provided in the runner v3 extras block (per-repo state file).
# Compare what landed on main since the last successful audit:
echo "=== CHANGED ON MAIN SINCE LAST AUDIT ===" && git diff --name-only "$DIFF_BASE"..origin/main
echo "=== DIFF STAT ===" && git diff --stat "$DIFF_BASE"..origin/main
echo "=== RECENT COMMITS ===" && git log --oneline "$DIFF_BASE"..origin/main
```

Save the list of changed files. **These are the highest-risk files** — they changed since the last audit and are the most likely source of new bugs. Agents must treat these as primary targets.

### Step 3: Create the branch

```bash
git checkout -b fix/bug-council-$(date +%Y%m%d)
```

---

## Phase 1: Focused Audit

Spawn **5 agents in parallel** using the Task tool. Each agent is **read-only** — no edits.

### What every agent receives

Every agent gets this preamble (fill in the `{VARIABLES}`):

```
You are a senior engineer auditing this codebase for real bugs.

## Context from Health Check
- Baseline test failures (ALREADY BROKEN — do NOT report these): {BASELINE_TEST_FAILURES}
- Baseline type errors (ALREADY BROKEN — do NOT report these): {BASELINE_TYPE_ERRORS}

## Recently Changed Files (HIGHEST PRIORITY)
These files changed since the last successful audit — they are the most likely source of new bugs.
Spend at least half your time here before moving to your broader domain.

{CHANGED_FILES_LIST}

## Your Domain
{DOMAIN_NAME}: {DOMAIN_DESCRIPTION}

## Key Files
{KEY_FILES}

Read the recently changed files in your domain first. Follow imports and trace call chains from those changes outward.

## What Counts as a Bug

A bug is ONLY:
- Code that produces **wrong output** for valid input
- Code that **crashes or throws** in a reachable code path
- A **security vulnerability** (auth bypass, data leak, injection)
- **Data loss or corruption** risk
- A **race condition** with concrete trigger scenario

A bug is NOT:
- Missing features or incomplete implementations
- Code style or formatting preferences
- "Should use X instead of Y" suggestions
- Missing error handling that MIGHT matter (show it DOES matter)
- Performance opinions without measured impact
- Missing tests, docs, or comments

## The Litmus Test

Before reporting any bug, answer: "Can I describe a specific, realistic scenario where a real user triggers this and sees wrong behavior?" If no, it's not a bug.

## Evidence Requirement

For each bug you report, you MUST provide ONE of:
1. A **test case** (vitest code) that would fail against the current code and pass after the fix
2. A **curl command** or API call that demonstrates the wrong behavior
3. A **step-by-step user action sequence** with the specific wrong outcome at each step

If you cannot provide evidence, do not report the bug.

## Output Format

Report 0 to 3 bugs. Zero is a valid, respectable answer — it means the code is solid. False positives waste time and erode trust.

For each bug:

### BUG-{DOMAIN_CODE}-{N}: {Short title}
- **Severity**: P0 (data loss/security) | P1 (crash/broken feature) | P2 (wrong behavior, user-visible)
- **File**: {path}
- **Lines**: {start}-{end}
- **What's wrong**: {Precise description — what does the code do vs. what should it do?}
- **Evidence**: {Test case, curl command, or step-by-step reproduction}
- **Proposed fix**: {Exact code change. Show before/after.}
- **Risk**: {What could this fix break? What should be tested after?}
- **Requires**: code-only | migration | product-decision
- **Confidence**: high | medium (include reasoning if medium)

If you find NO bugs: "CLEAN: No bugs found in {DOMAIN_NAME}. Files investigated: {list}"
```

### The 5 Council Members

**1. Critical Paths — Auth, Data Integrity, Financial Accuracy (CRITICAL)**
- Description: Authentication checks on every API route, correct user isolation, financial math (rounding, signs, currency), data relationships between tables.
- Key files: `app/api/**/route.ts`, `lib/demo.ts`, `lib/supabase.ts`, `middleware.ts`, `lib/currency.ts`, `hooks/useCurrency.ts`, `lib/subscription-detect.ts`, `lib/transaction-sync.ts`
- Focus: API routes missing `getEffectiveUserId()`, user A seeing user B's data, rounding errors in financial calculations, sign confusion (positive vs negative amounts), orphan records, foreign key violations.

**2. API Resilience — Error Handling, Races, Timeouts (RESILIENCE)**
- Description: What happens when external services fail (Plaid, Supabase, OpenAI, Stripe). Race conditions in concurrent operations. Missing timeouts.
- Key files: `app/api/**/route.ts`, `lib/plaid-client.ts`, `lib/transaction-sync.ts`, `lib/search-engine.ts`, `hooks/useTransactions.ts`, `hooks/useSubscriptions.ts`
- Focus: Empty catch blocks that swallow errors, `.json()` called before `.ok` check, missing AbortController on fetches, errors returned as HTTP 200, concurrent syncs corrupting state, unhandled promise rejections.

**3. Client-Side Correctness — State, Caching, UI (CLIENT)**
- Description: Loading states, stale data, cache invalidation, flash of wrong content, state consistency across pages.
- Key files: `app/app/*/page.tsx`, `hooks/*.ts`, `components/*.tsx`, `lib/cached-queries.ts`
- Focus: Loading spinners missing during fetch, empty state shown before data loads, cache keys missing user ID (data leak between users), stale data after mutations, setState after unmount, useEffect dependency issues causing infinite loops.

**4. User Journey: New User Onboarding (ONBOARD)**
- Description: Trace the exact path: sign up → connect bank → see data. Every step must work.
- Key files: `app/connect/page.tsx`, `app/api/plaid/create-link-token/route.ts`, `app/api/plaid/exchange-token/route.ts`, `lib/transaction-sync.ts`, `app/app/dashboard/page.tsx`
- Trace: (1) Sign up → redirect to connect? (2) Click Connect Bank → Plaid Link init? (3) Plaid completes → exchange fires? (4) Token exchanged → sync triggers? What does user see while syncing? (5) Sync done → dashboard shows data? Or stale cache? (6) Navigate to Transactions → data visible or flash of empty?
- ONLY report issues where a real user would be stuck, confused, or see wrong data.

**5. User Journey: Returning User Daily Flow (DAILY)**
- Description: Trace daily usage: open app → dashboard → transactions → subscriptions → shared → settings. Cross-page consistency.
- Key files: `app/app/dashboard/page.tsx`, `app/app/transactions/page.tsx`, `app/app/subscriptions/page.tsx`, `app/app/shared/page.tsx`, `app/app/settings/page.tsx`
- Trace: (1) Dashboard → correct month data? Empty month handled? (2) Transactions → search works? Filter by account? (3) Subscriptions → detection works? List updates without reload? (4) Settings → currency change persists across pages? Connected bank shows? (5) Navigation → back button, stale data, quick page switches.
- Focus on CROSS-PAGE inconsistencies — state set on one page not reflecting on another.

---

## Phase 2: Verify

After ALL 5 agents return:

1. Read `docs/BUG_COUNCIL_FALSE_POSITIVES.md` and reject matching reports unless `git show origin/main:FILE` proves the bug still exists.
2. For each remaining bug, verify on main with `git grep` or `git show origin/main:path`.

Then spawn ONE **Devil's Advocate** agent.

### Devil's Advocate Prompt

```
You are a skeptical senior engineer. Your job is to DISPROVE each reported bug. You WANT to find that the bug is not real. This is adversarial — you are trying to reduce the list, not expand it.

## Reported Bugs
{PASTE ALL BUG REPORTS HERE}

## Pre-existing Issues (not bugs — already broken before this audit)
- Test failures: {BASELINE_TEST_FAILURES}
- Type errors: {BASELINE_TYPE_ERRORS}

## For Each Bug, Investigate

1. **Read the actual code** at the file and line numbers cited. Does it match the description?
2. **Is the code path reachable?** Trace callers. Is this dead code? Is there a guard earlier in the flow that prevents this?
3. **Is it already handled elsewhere?** Maybe the error is caught by a parent component, a middleware, or a try/catch higher up.
4. **Would the proposed fix actually help?** Or would it introduce a new bug?
5. **Is this a pre-existing issue?** Check if it's in the baseline failures list.
6. **Is the severity accurate?** A P0 must involve data loss, security breach, or financial error. A P1 must crash or completely break a feature. Downgrade inflated severities.

## Output

For each bug, output ONE of:
- **VERIFIED**: BUG-XX-N — {reason it's real, with evidence you found}
- **DISPROVED**: BUG-XX-N — {specific reason it's not a real bug}
- **DOWNGRADED**: BUG-XX-N from P{X} to P{Y} — {reason severity was wrong}

Then output the final **VERIFIED BUG LIST** — only bugs that survived your review, sorted by severity.
```

### After Verification

1. Print the verified bug list for the user.
2. Remove any bugs with `Requires: migration` or `Requires: product-decision` — move to "Deferred" section.
3. Only `Requires: code-only` bugs proceed to Phase 3.
4. Print the fix queue:

```
=== FIX QUEUE ({N} verified bugs) ===
1. [P0] BUG-CRITICAL-1: Missing auth check on /api/foo — file.ts
2. [P1] BUG-RESILIENCE-2: res.json() before res.ok — file.ts

=== DISPROVED ({M} bugs rejected) ===
- BUG-CLIENT-3: Not reachable — guard on line 42 prevents this path

=== DEFERRED ({K} bugs, need migration/product decision) ===
- BUG-CRITICAL-2: Orphan records (requires migration)
```

---

## Phase 3: Fix + Test

For each verified bug, spawn a **Fixer Agent** using the Task tool.

### Fixer Agent Prompt

```
You are a Bug Fixer agent. You fix ONE bug and write a test for it.

## Bug Report
{PASTE FULL VERIFIED BUG REPORT}

## Instructions

1. Read the file(s) on **origin/main** (`git show origin/main:path`). If main already has the fix → **SKIP: already on main** (no commit).
2. Confirm the bug exists on main before editing. **Never modify `package-lock.json`** unless required by a verified dependency fix.
3. Implement the MINIMUM fix. Do not refactor unrelated code.
4. Write a vitest test that:
   - FAILS against the old code (demonstrates the bug)
   - PASSES with your fix applied
   - Lives in a test file next to the source (e.g., `lib/foo.ts` → `lib/foo.test.ts`, or add to existing test file if one exists)
   - If the code is untestable (React component rendering, platform-specific, requires real API), explain WHY and skip the test — but this should be rare.
5. Run the test to verify it passes:
   ```
   npx vitest run {test_file} --reporter=verbose
   ```
6. Stage all changed files (source fix + test) and commit:
   ```
   fix({DOMAIN_CODE}): {bug title}

   {What was wrong and what the fix does — one line}

   Bug-ID: BUG-{DOMAIN_CODE}-{N}
   Severity: {P0|P1|P2}
   Test: {test file path, or "untestable: {reason}"}
   ```
7. Do NOT push. Do NOT create a PR.
8. If the bug does not exist as described, respond with "SKIP: {reason}" and do NOT commit.
```

### Execution Strategy

- **Different files**: run fixer agents in parallel.
- **Same file**: run sequentially to prevent edit conflicts.
- Group by file, run file-groups in parallel.

---

## Phase 4: Validate

After ALL fixer agents complete:

### Step 1: Type check
```bash
npm run typecheck 2>&1
```
If new type errors appear (not in Phase 0 baseline), identify which commit introduced them. Revert it: `git revert --no-edit <sha>`.

### Step 2: Lint
```bash
npm run lint 2>&1
```
If new lint errors appear, try to fix them. If the fix is non-trivial, revert the offending commit.

### Step 3: Test suite
```bash
npm run test 2>&1
```
Compare against Phase 0 baseline:
- **New test passes**: Good — these are the tests we added.
- **Pre-existing test now fails**: A fix broke something. Revert the offending commit.
- **New test fails**: The fix is wrong. Revert it.

### Step 4: Final commit log
```bash
git log --oneline $(git merge-base HEAD main)..HEAD
```
Print the surviving commits.

---

## Phase 5: Learn + PR

### Step 1: Tag for next run
```bash
git tag bug-council-$(date +%Y%m%d)
```

### Step 2: Analyze patterns

Look at all verified bugs (including disproved and deferred). If 2+ bugs share a root cause pattern, note it. Examples:
- "Missing `res.ok` check before `res.json()`" — this is a pattern
- "State setter in `finally` gated by a flag" — this is a pattern
- "AbortController not forwarded to chained fetches" — this is a pattern

### Step 3: Update cursor rules (if warranted)

If a pattern appeared 3+ times across this or recent audits, read `.cursor/rules/common-bugs.mdc` (create it if it doesn't exist). Append the pattern as a one-line rule. Format:

```markdown
---
description: Common bug patterns discovered by Bug Council audits. Follow these to avoid recurring issues.
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

# Common Bug Patterns

- Always check `res.ok` before calling `res.json()` — server errors return HTML, not JSON
- Call `setLoading(false)` unconditionally in `finally` blocks — never gate on flags like `silent`
```

Only add rules that are specific and actionable. Do not add vague advice.

### Step 4: Create PR (only if there are fix commits)

```bash
git log --oneline origin/main..HEAD | grep -E '^[a-f0-9]+ fix' || { echo "PR_NUMBER=none"; exit 0; }
git diff --name-only origin/main..HEAD | grep -qvE '^(package-lock\.json|\.cursor/rules/common-bugs\.mdc)$' || { echo "PR_NUMBER=none"; exit 0; }

gh pr create --title "fix: bug council audit — {N} bugs fixed" --body "$(cat <<'EOF'
## Bug Council Audit Results

**Bugs reported by agents**: {total_reported}
**Bugs verified (survived Devil's Advocate)**: {total_verified}
**Bugs fixed (with tests)**: {total_fixed}
**Bugs deferred**: {total_deferred}
**False positives rejected**: {total_disproved}

## Fixed Bugs

### P0 — Critical
{list or "None"}

### P1 — Broken Functionality
{list each: **BUG-ID**: description — `file` (test: `test_file`)}

### P2 — Incorrect Behavior
{list each}

## Tests Added
{list each test file and what it covers}

## Deferred Bugs (Not Fixed)
{list each with reason: requires migration / product decision}

## Disproved Bugs (Rejected by Devil's Advocate)
{list each with reason — this builds trust by showing rigor}

## Patterns Found
{list recurring patterns, note if any were added to .cursor/rules/common-bugs.mdc}

## Verification
- [x] `npm run typecheck` — passes (no new errors vs baseline)
- [x] `npm run lint` — passes (no new errors vs baseline)
- [x] `npm run test` — passes ({N} new tests added, all green)

---
Generated by Bug Council v3 (evidence-based)
EOF
)"
```

After create, print: `PR_NUMBER=<number>`. If skipped: `PR_NUMBER=none`.

### Step 5: Get CI green

After creating the PR:

1. Wait for CI: `gh pr checks <PR_NUMBER> --watch`
2. If checks fail, read the failure logs: `gh run view <RUN_ID> --log-failed`
3. Fix locally, run `npm run typecheck && npm run lint && npm run test` to confirm, then push.
4. Repeat up to 3 times. After 3 failures, report the issue in a PR comment and stop.

---

## Important Constraints

- Every reported bug must have evidence (test case, reproduction steps, or API call)
- Zero bugs is a valid outcome — do not inflate findings
- Each fix must include a test (or a documented reason why it's untestable)
- Do NOT refactor code that isn't buggy
- Do NOT add features, comments, documentation, or type annotations to unchanged code
- Do NOT modify test files unless there's an actual bug in the test
- Each fix is the minimum change necessary
- Bugs requiring migration or product decisions: report but do NOT fix
- All fixes go on ONE branch, ONE PR per run; runner auto-closes empty/lockfile/conflicting stale PRs
- False positives damage trust — be precise, not prolific
- Do **not** reintroduce Splitwise shadow/parity/mirror debug tooling (removed intentionally)
