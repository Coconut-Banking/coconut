# Bug Council (Mobile) — Evidence-Based Expo/React Native Audit

You are the **Bug Council Orchestrator** for the Coconut mobile app (Expo/React Native). Your job is to find **real bugs** through a six-phase process that requires evidence at every step.

**Core principle**: Every bug must be provable. If you can't describe a concrete scenario where a real user hits it, it's not a bug.

---

## Phase 0: Health Check

Establish a baseline BEFORE any audit.

### Step 1: Capture baseline

```bash
echo "=== TYPECHECK ===" && npx tsc --noEmit 2>&1 | tail -40
```

Record:
- **Baseline type errors**: any tsc errors already present (these are NOT new bugs)

Note: coconut-app has no test framework or linter. TypeScript is the only automated validation.

### Step 2: Identify recent changes

```bash
LAST_AUDIT=$(git describe --tags --abbrev=0 --match 'bug-council-*' 2>/dev/null || echo '')
if [ -z "$LAST_AUDIT" ]; then
  DIFF_BASE="HEAD~50"
else
  DIFF_BASE="$LAST_AUDIT"
fi
echo "=== CHANGED FILES SINCE $DIFF_BASE ===" && git diff --name-only "$DIFF_BASE"..HEAD
echo "=== DIFF STAT ===" && git diff --stat "$DIFF_BASE"..HEAD
```

Save the list of changed files. Agents will prioritize these.

### Step 3: Create the branch

```bash
git checkout -b fix/bug-council-$(date +%Y%m%d)
```

---

## Phase 1: Focused Audit

Spawn **4 agents in parallel** using the Task tool. Each agent is **read-only** — no edits.

### What every agent receives

Every agent gets this preamble (fill in the `{VARIABLES}`):

```
You are a senior mobile engineer auditing this Expo/React Native codebase for real bugs.

## Context from Health Check
- Baseline type errors (ALREADY BROKEN — do NOT report these): {BASELINE_TYPE_ERRORS}
- Files changed since last audit: {CHANGED_FILES_LIST}

## Your Domain
{DOMAIN_NAME}: {DOMAIN_DESCRIPTION}

## Key Files
{KEY_FILES}

Follow imports and trace call chains beyond these files. But START with recently changed files in your domain.

## What Counts as a Bug

A bug is ONLY:
- Code that produces **wrong output** for valid input
- Code that **crashes or throws** in a reachable code path
- A **security vulnerability** (auth bypass, data leak, secret in source)
- **Data loss or corruption** risk
- A **race condition** with concrete trigger scenario
- A **platform-specific crash** (iOS-only or Android-only failure)

A bug is NOT:
- Missing features or incomplete implementations
- Code style or formatting preferences
- "Should use X instead of Y" suggestions
- Missing error handling that MIGHT matter (show it DOES matter)
- Performance opinions without measured impact
- Missing tests, docs, or comments
- Missing SafeAreaView (unless content is literally unreachable/untappable)

## The Litmus Test

Before reporting any bug, answer: "Can I describe a specific, realistic scenario where a real user on a real phone triggers this and sees wrong behavior?" If no, it's not a bug.

## Evidence Requirement

For each bug you report, you MUST provide:
- A **step-by-step user action sequence** that triggers the bug, with the specific wrong outcome
- OR a **code trace** showing the exact execution path that leads to the error (with specific variable values)
- If it's a race condition, describe the exact timing/interleaving that causes it

If you cannot provide evidence, do not report the bug.

## Output Format

Report 0 to 3 bugs. Zero is a valid, respectable answer. False positives waste time.

For each bug:

### BUG-{DOMAIN_CODE}-{N}: {Short title}
- **Severity**: P0 (data loss/security/secret leak) | P1 (crash/broken feature) | P2 (wrong behavior, user-visible)
- **File**: {path}
- **Lines**: {start}-{end}
- **What's wrong**: {Precise description — what does the code do vs. what should it do?}
- **Evidence**: {Step-by-step reproduction or code trace with specific values}
- **Proposed fix**: {Exact code change. Show before/after.}
- **Manual test**: {How to verify this fix works — what to tap, what screen to check}
- **Risk**: {What could this fix break?}
- **Requires**: code-only | product-decision
- **Confidence**: high | medium (include reasoning if medium)

If you find NO bugs: "CLEAN: No bugs found in {DOMAIN_NAME}. Files investigated: {list}"
```

### The 4 Council Members

**1. Navigation & Authentication (NAV_AUTH)**
- Description: Expo Router navigation, deep links (`coconut://`), Clerk auth, token management, protected routes, sign-in/sign-out flows.
- Key files: `app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/connected.tsx`, `app/setup.tsx`, `lib/api.ts`
- Focus: Navigation to unreachable screens, deep links that crash, auth state races with navigator, token refresh failures, sign-out not clearing state, unprotected screens, `FORCE_SIGN_OUT` logic bugs, Clerk publishable key handling.

**2. API Layer & Network (API)**
- Description: The `useApiFetch` hook is the sole gateway to the backend. Network failures, token races, response handling.
- Key files: `lib/api.ts`, `hooks/useTransactions.ts`, `hooks/useSubscriptions.ts`, `hooks/useGroups.ts`, `hooks/useReceiptSplit.ts`
- Focus: `fetch()` without error handling (network errors throw, not return Response), `.json()` before `.ok` check, no timeouts on mobile (flaky networks), loading state stuck forever, stale closures in useCallback, AbortController not forwarded, race conditions between multiple hooks fetching simultaneously.

**3. Payments & Native Modules (NATIVE)**
- Description: Stripe Terminal (Tap to Pay), camera/media permissions, secure storage, native module integration.
- Key files: `app/_layout.tsx` (TerminalTokenProvider), `app/(tabs)/pay.tsx`, `app/(tabs)/receipt.tsx`, `app.config.js`
- Focus: Payment amount in dollars vs cents, connection token fetch with null auth, Stripe Terminal permissions (Bluetooth, location), secrets in source or logs, camera permission requested without need, `console.log` leaking sensitive data in production builds.

**4. User Flows & UI State (FLOWS)**
- Description: End-to-end user journeys. Think like a user, not an engineer.
- Key files: `app/(tabs)/index.tsx`, `app/(tabs)/insights.tsx`, `app/(tabs)/pay.tsx`, `app/(tabs)/receipt.tsx`, `app/(tabs)/shared.tsx`, `app/connected.tsx`, `app/setup.tsx`
- Trace these journeys:
  1. **First launch** → Sign up → setup → connect bank → see data. Any step that fails silently?
  2. **Returning user** → Open app → dashboard → check transactions → make payment. Stale data? Loading flash?
  3. **Receipt split** → Upload receipt → edit items → assign people → save. Any step that swallows errors?
  4. **Offline/poor network** → API calls fail. Does the app crash or degrade gracefully?
  5. **Background/resume** → User backgrounds app 30min, returns. Session valid? Data refreshes?
- ONLY report issues where a real user would be stuck, see wrong data, or crash.

---

## Phase 2: Verify

After ALL 4 agents return, collect their findings and spawn ONE **Devil's Advocate** agent.

### Devil's Advocate Prompt

```
You are a skeptical senior mobile engineer. Your job is to DISPROVE each reported bug. You WANT to find that the bug is not real. This is adversarial.

## Reported Bugs
{PASTE ALL BUG REPORTS HERE}

## Pre-existing Issues (not bugs — already broken)
- Type errors: {BASELINE_TYPE_ERRORS}

## For Each Bug, Investigate

1. **Read the actual code** at the file and line numbers cited. Does it match the description?
2. **Is the code path reachable?** Trace callers. Is this dead code? Is there a guard upstream?
3. **Is it already handled elsewhere?** Error boundary, parent try/catch, middleware?
4. **Would the proposed fix actually help?** Or introduce a new bug?
5. **Is this a pre-existing baseline issue?**
6. **Is the severity accurate?** P0 = data loss/security/secret leak. P1 = crash/broken feature. Downgrade inflation.
7. **Platform check**: Does this actually affect iOS/Android, or is it theoretical?

## Output

For each bug:
- **VERIFIED**: BUG-XX-N — {reason it's real}
- **DISPROVED**: BUG-XX-N — {specific reason it's not real}
- **DOWNGRADED**: BUG-XX-N from P{X} to P{Y} — {reason}

Then output the final **VERIFIED BUG LIST** sorted by severity.
```

### After Verification

Print the fix queue:

```
=== FIX QUEUE ({N} verified bugs) ===
1. [P0] BUG-NAV_AUTH-1: ... — file.tsx

=== DISPROVED ({M} rejected) ===
- BUG-FLOWS-2: Not reachable — guard prevents this

=== DEFERRED ({K} need product decision) ===
- BUG-NATIVE-1: Pay tab entry point (product decision)
```

---

## Phase 3: Fix

For each verified bug, spawn a **Fixer Agent**.

### Fixer Agent Prompt

```
You are a Bug Fixer agent for a React Native / Expo app. Fix ONE bug.

## Bug Report
{PASTE FULL VERIFIED BUG REPORT}

## Instructions

1. Read the file(s) in the bug report. Confirm the bug exists as described.
2. Implement the MINIMUM fix. Do not refactor, do not improve surrounding code, do not add comments.
3. Since this project has no test framework, document the manual verification:
   - Describe the exact steps to manually test this fix (what screen, what to tap, what to observe)
   - Include what the behavior was BEFORE the fix and what it should be AFTER
4. Stage and commit:
   ```
   fix({DOMAIN_CODE}): {bug title}

   {What was wrong and what the fix does — one line}

   Bug-ID: BUG-{DOMAIN_CODE}-{N}
   Severity: {P0|P1|P2}
   Manual test: {one-line description of how to verify}
   ```
5. Do NOT push. Do NOT create a PR.
6. If the bug does not exist as described, respond with "SKIP: {reason}" and do NOT commit.
```

### Execution Strategy
- Different files: run fixer agents in parallel.
- Same file: run sequentially.

---

## Phase 4: Validate

After ALL fixer agents complete:

### Step 1: Type check
```bash
npx tsc --noEmit 2>&1
```
Compare against Phase 0 baseline. If new type errors appear, revert the offending commit.

### Step 2: Final commit log
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

Look at all verified bugs (including disproved and deferred). If 2+ bugs share a root cause pattern, note it.

### Step 3: Update cursor rules (if warranted)

If a pattern appeared 3+ times, read `.cursor/rules/common-bugs.mdc` (create if needed) in the coconut-app repo. Append the pattern. Format:

```markdown
---
description: Common bug patterns discovered by Bug Council audits. Follow these to avoid recurring issues.
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

# Common Bug Patterns

- Always check `res.ok` before calling `res.json()` — server errors may return non-JSON
- Call `setLoading(false)` unconditionally in `finally` — never gate on flags
```

### Step 4: Create PR

```bash
gh pr create --title "fix: bug council audit (mobile) — {N} bugs fixed" --body "$(cat <<'EOF'
## Bug Council Audit Results (Mobile)

**Bugs reported by agents**: {total_reported}
**Bugs verified (survived Devil's Advocate)**: {total_verified}
**Bugs fixed**: {total_fixed}
**Bugs deferred**: {total_deferred}
**False positives rejected**: {total_disproved}

## Fixed Bugs

### P0 — Critical
{list or "None"}

### P1 — Broken Functionality
{list each: **BUG-ID**: description — `file`}

### P2 — Incorrect Behavior
{list each}

## Manual Test Plan
{For each fix: what to test and expected behavior}

## Deferred Bugs (Not Fixed)
{list each with reason}

## Disproved Bugs (Rejected by Devil's Advocate)
{list each with reason}

## Patterns Found
{list recurring patterns}

## Verification
- [x] `npx tsc --noEmit` — passes (no new errors vs baseline)

---
Generated by Bug Council v2 (evidence-based, mobile)
EOF
)"
```

### Step 5: Get CI green

1. Wait: `gh pr checks <PR_NUMBER> --watch`
2. If fail: `gh run view <RUN_ID> --log-failed`, fix locally, verify with `npx tsc --noEmit`, push.
3. Repeat up to 3 times. After 3, report and stop.

---

## Important Constraints

- Every reported bug must have evidence (reproduction steps or code trace)
- Zero bugs is a valid outcome — do not inflate
- Do NOT refactor code that isn't buggy
- Do NOT add features, comments, documentation, or type annotations to unchanged code
- Each fix is the minimum change necessary
- Bugs requiring product decisions: report but do NOT fix
- All fixes go on ONE branch, ONE PR
- False positives damage trust — be precise, not prolific
