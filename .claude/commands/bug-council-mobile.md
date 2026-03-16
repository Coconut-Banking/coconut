# Bug Council (Mobile) — React Native / Expo Codebase Audit

You are the **Bug Council Orchestrator** for the Coconut mobile app (Expo/React Native). Your job is to coordinate a thorough, three-phase bug audit using specialized agents, then produce a single consolidated PR with all verified fixes.

## Architecture: Three-Phase Approach

**Phase 1: AUDIT (read-only)** — Spawn 7 specialized agents in parallel. Each is read-only. No code changes.

**Phase 2: TRIAGE** — Collect all findings. Deduplicate. Prioritize. Build a fix queue.

**Phase 3: FIX** — For each bug in the fix queue, spawn a dedicated **Fixer Agent** that implements the fix and commits it. All fixes land on a single branch. One PR at the end.

---

## Phase 1: Spawn Audit Agents

First, create a new git branch:
```
git checkout -b fix/bug-council-$(date +%Y%m%d)
```

Then spawn ALL 7 agents **in parallel** using the Task tool (subagent_type "general-purpose"). Each agent gets the prompt below with their specific domain injected. **Every agent is read-only** — they investigate using Read, Grep, Glob only. No edits.

### Agent Prompt Template

Each agent receives this prompt (with `{DOMAIN_NAME}`, `{DOMAIN_CODE}`, `{DOMAIN_DESCRIPTION}`, `{KEY_FILES}`, and `{WHAT_TO_LOOK_FOR}` filled in):

```
You are a senior engineer on the Bug Council, specializing in {DOMAIN_NAME}.

## Your Mission
Audit this codebase for bugs in your domain: {DOMAIN_DESCRIPTION}

## Key Files to Start With
{KEY_FILES}

But do NOT limit yourself to these files. Follow imports, trace call chains, and read any file relevant to your domain. Be thorough.

## What to Look For
{WHAT_TO_LOOK_FOR}

## Rules
- ONLY report actual bugs — not style preferences, not TODOs, not "could be better" suggestions
- A bug is: incorrect behavior, data loss risk, security vulnerability, crash/error, or broken user-facing functionality
- Do NOT report: missing features, code style issues, missing tests, missing documentation, performance opinions
- Max 5 bugs. If you find more, report only the top 5 by severity.
- Do NOT modify any files. This is a read-only investigation.

## Output Format
For each bug, report EXACTLY this structured format (this will be parsed by another agent):

### BUG-{DOMAIN_CODE}-{N}: {Short title}
- **Severity**: P0 (data loss/security) | P1 (broken functionality) | P2 (incorrect behavior) | P3 (cosmetic/minor)
- **File**: {absolute file path}
- **Lines**: {start line}-{end line}
- **Description**: {What's wrong and why it's a bug — be specific}
- **Impact**: {What happens to the user or system when this bug triggers}
- **Reproduction**: {Step-by-step to trigger this bug}
- **Proposed Fix**: {Exact code change needed. Show the current code and what it should be changed to. Be precise enough that a developer who has never seen this file can implement it.}
- **Risk**: {Could this fix break anything else? What should be tested after?}
- **Requires**: code-only | migration | product-decision

If you find NO bugs in your domain, report: "CLEAN: No bugs found in {DOMAIN_NAME}. Files investigated: {list of files checked}."
```

---

### The 7 Council Members

**1. Navigation & Deep Linking (NAV)**
- Description: Expo Router file-based navigation, deep links, tab navigation, screen transitions, back button behavior.
- Key files: `app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/connected.tsx`
- Look for: Missing or broken navigation routes, deep link schema (`coconut://`) not resolving correctly, tab bar inconsistencies, screens that crash on mount due to missing params, back button navigating to unexpected screens, navigation state not resetting on logout, Stack.Screen names not matching file-based routes

**2. Authentication — Clerk Expo (AUTH)**
- Description: Clerk authentication in Expo, sign-in/sign-up flows, token management, protected routes, session handling.
- Key files: `app/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `lib/api.ts`
- Look for: Unprotected screens accessible without auth, token refresh failures in `getTokenWithRetry`, sign-out not clearing local state, Clerk hooks used outside ClerkProvider, race conditions between auth state and navigation (the `FORCE_SIGN_OUT` logic), stale tokens passed to API calls, `tokenCache` disabled incorrectly

**3. Payments — Stripe Terminal Mobile (PAYMENTS)**
- Description: Stripe Terminal SDK integration, card reader connection, payment processing via Tap to Pay.
- Key files: `app/_layout.tsx` (TerminalTokenProvider), `app/(tabs)/pay.tsx`, `hooks/useStripe*`
- Look for: StripeTerminalProvider connection token fetch failing silently, missing error handling when `getToken()` returns null but fetch proceeds with empty Authorization header, payment amount sign/decimal issues, Tap to Pay entitlement misconfiguration, bluetooth permission issues

**4. API Layer & Network Resilience (API)**
- Description: The `useApiFetch` hook is the sole gateway to the backend. Every screen depends on it. Network failures, token races, and response handling bugs here affect the entire app.
- Key files: `lib/api.ts`, `hooks/useTransactions.ts`, `hooks/useSubscriptions.ts`, `hooks/useGroups.ts`, `hooks/useReceiptSplit.ts`
- Look for: Missing error handling on `fetch()` calls (network errors throw, not return Response), no timeout on API calls (mobile networks are flaky), response `.json()` called without checking `res.ok` first, hooks not handling loading/error states properly, stale closures in `useCallback` with empty dependency arrays, race conditions when multiple hooks fetch simultaneously, no retry logic for transient network failures

**5. Secure Storage & Native Modules (NATIVE)**
- Description: Sensitive data handling, native module integration, permissions. Mobile apps must protect tokens and handle native APIs carefully.
- Key files: `app/_layout.tsx`, `lib/api.ts`, `app.config.js`, `app/(tabs)/receipt.tsx`, `app/(tabs)/add-expense.tsx`
- Look for: Sensitive data (tokens, keys) stored in plain AsyncStorage instead of expo-secure-store, expo-clipboard copying sensitive data without clearing, expo-image-picker/document-picker used without permission checks, Stripe Terminal bluetooth/location permissions not requested before use, publishable keys hardcoded and logged to console, `console.log` statements leaking auth tokens or user data in production

**6. UI State & Platform Differences (UISTATE)**
- Description: iOS vs Android rendering differences, loading states, error states, keyboard handling, safe area insets, gesture conflicts.
- Key files: `app/(tabs)/*.tsx`, `app/(auth)/*.tsx`, `app/connected.tsx`
- Look for: Missing SafeAreaView wrapping (content under notch/status bar), keyboard covering input fields on sign-in/sign-up, platform-specific crashes (iOS-only or Android-only code paths), loading spinners not shown during async operations, error states that show blank screens instead of messages, gesture handler conflicts with tab navigation, StatusBar style not matching dark/light mode

**7. User Flows — Onboarding & Daily Use (FLOWS)**
- Description: End-to-end user journeys from first launch through daily usage. Think like a user, not an engineer.
- Key files: `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/connected.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/insights.tsx`, `app/(tabs)/pay.tsx`, `app/(tabs)/receipt.tsx`, `app/(tabs)/shared.tsx`, `app/(tabs)/add-expense.tsx`
- Look for — trace these journeys:
  1. **First launch** → Sign up → connect bank (via web?) → see data. Any step that could fail silently or show confusing UI?
  2. **Returning user** → Open app → see dashboard → check transactions → make a payment. Stale data? Loading flash? Empty states?
  3. **Cross-screen state** → Add an expense on one tab, navigate to another. Does the data reflect?
  4. **Offline/poor network** → What happens when API calls fail? Does the app crash or degrade gracefully? Are there any `fetch()` calls without error handling?
  5. **App backgrounding** → User backgrounds app, comes back 30min later. Is the session still valid? Does data refresh?
  - Focus on CROSS-SCREEN inconsistencies, broken transitions, and silent failures.

---

## Phase 2: Triage

After ALL 7 agents return their reports:

1. **Collect all bugs** into a single master list.

2. **Deduplicate**: If two agents found the same bug, merge into one entry.

3. **Filter out non-fixable bugs**:
   - Bugs with `Requires: migration` → "Reported but not fixed"
   - Bugs with `Requires: product-decision` → "Reported but not fixed"
   - Only `Requires: code-only` proceed to Phase 3

4. **Build the Fix Queue**: Order by priority (P0 first, P3 last).

5. **Print the fix queue** before proceeding.

---

## Phase 3: Fix

For each bug in the fix queue, spawn a **Fixer Agent** using the Task tool (subagent_type "general-purpose").

### Fixer Agent Prompt Template

```
You are a Bug Fixer agent. Your job is to implement ONE specific bug fix.

## Bug Report
{paste the full bug report here}

## Instructions
1. Read the file(s) mentioned in the bug report.
2. Implement the proposed fix. If unclear, use your judgment for a correct minimal fix.
3. ONLY change what is necessary. Do not refactor, add comments, or make unrelated improvements.
4. Stage and commit with this format:
   fix({DOMAIN_CODE}): {bug title}

   {One-line description}

   Bug-ID: BUG-{DOMAIN_CODE}-{N}
   Severity: {P0|P1|P2|P3}

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
5. Do NOT push. Do NOT create a PR. Just commit locally.
6. If the fix cannot be safely implemented, respond with "SKIP: {reason}".
```

### Execution Strategy
- Non-overlapping fixes (different files): spawn in parallel.
- Overlapping fixes (same file): run sequentially.

### Post-Fix Verification

After ALL fixer agents complete:

1. Run `npx tsc --noEmit` to check for type errors. If new errors, revert the offending commit.

2. Run `git log --oneline fix/bug-council-$(date +%Y%m%d)..HEAD` to get the final commit list.

---

## Phase 4: Create PR

```
gh pr create --title "fix: bug council audit (mobile) — {N} bugs fixed" --body "$(cat <<'EOF'
## Bug Council Audit Results (Mobile)

**Agents deployed**: 7 (5 technical + 2 product/UX)
**Bugs found**: {total found}
**Bugs fixed**: {total fixed}
**Bugs deferred**: {total not fixed}

## Fixed Bugs

### P0 — Critical
{list or "None"}

### P1 — Broken Functionality
{list each}

### P2 — Incorrect Behavior
{list each}

### P3 — Cosmetic
{list each}

## Deferred Bugs (Not Fixed)
{list each with reason}

## Verification
- [x] `tsc --noEmit` passes
- [ ] Manual smoke test of affected flows

## Agents That Found No Bugs
{list domains that reported CLEAN}

---
Generated by Bug Council skill (mobile)
EOF
)"
```

---

## Phase 5: Get CI Green

After creating the PR, ensure CI passes so the PR is merge-ready.

### Step 1: Wait for CI and check status

```
gh pr checks <PR_NUMBER> --watch
```

If all checks pass, you're done — skip to the summary.

### Step 2: Diagnose failures

If any check fails:

1. Get the failed run logs:
   ```
   gh run view <RUN_ID> --log-failed
   ```
2. Identify the root cause. Common failures:
   - **TypeScript errors**: Missing imports, type mismatches introduced by the fix
   - **Expo export errors**: Invalid component exports, missing dependencies

### Step 3: Fix and push

1. Fix the issue locally
2. Run `npx tsc --noEmit` locally to verify before pushing
3. Commit with message: `fix: resolve CI failure ({brief description})`
4. Push to the PR branch

### Step 4: Repeat

Go back to Step 1. Maximum 5 attempts — if CI still fails after 5 rounds, report the failure with full context.

### Goal

The PR should be **ready to merge** when the user sees it.

---

## Important Constraints

- Do NOT refactor code that isn't buggy
- Do NOT add features
- Do NOT change code style or formatting
- Do NOT add comments, documentation, or type annotations to code you didn't change
- Each fix must be the minimum change necessary
- If a bug requires a database migration, report it but do NOT fix it
- If a bug requires a product/design decision, report it but do NOT fix it
- All fixes go on ONE branch, ONE PR
