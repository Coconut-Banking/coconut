# Bug Council — Production-Level Codebase Audit

You are the **Bug Council Orchestrator**. Your job is to coordinate a thorough, three-phase bug audit of this codebase using specialized agents, then produce a single consolidated PR with all verified fixes.

## Architecture: Three-Phase Approach

**Phase 1: AUDIT (read-only)** — Spawn 12 specialized agents in parallel. 10 are technical domain experts, 2 are product flow testers who trace real user journeys across pages. Every agent is read-only. No code changes.

**Phase 2: TRIAGE** — Collect all findings. Deduplicate. Prioritize. Build a fix queue.

**Phase 3: FIX** — For each bug in the fix queue, spawn a dedicated **Fixer Agent** that implements the fix and commits it. All fixes land on a single branch. One PR at the end.

---

## Phase 1: Spawn Audit Agents

First, create a new git branch:
```
git checkout -b fix/bug-council-$(date +%Y%m%d)
```

Then spawn ALL 12 agents **in parallel** using the Task tool (use subagent_type "general-purpose"). Each agent gets the prompt below with their specific domain injected. **Every agent is read-only** — they investigate using Read, Grep, Glob only. No edits.

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

### The 12 Council Members

#### Technical Domain Agents (1-10)

**1. Financial Data Accuracy (FINDATA)**
- Description: Amounts, currency conversions, rounding, sign conventions (negative = expense). This is a finance app — even small math errors are critical.
- Key files: `lib/currency.ts`, `hooks/useCurrency.ts`, `lib/subscription-detect.ts`, `components/transaction-ui.tsx`, `app/app/dashboard/page.tsx`
- Look for: Rounding errors, sign confusion (positive vs negative amounts), currency conversion bugs, formatCurrency called with wrong arguments, Math.abs applied incorrectly, integer vs float issues, NaN propagation, division by zero in averages or percentages

**2. Plaid Integration Edge Cases (PLAID)**
- Description: Plaid API calls, webhook handling, token management, item lifecycle, sync logic.
- Key files: `app/api/plaid/*/route.ts`, `lib/plaid-client.ts`, `lib/transaction-sync.ts`, `app/api/plaid/webhook/route.ts`
- Look for: Missing error handling on Plaid API calls, webhook verification bypasses, stale access tokens not refreshed, sync cursor corruption, race conditions in concurrent syncs, missing null checks on Plaid response fields

**3. Authentication & Authorization (AUTH)**
- Description: Every API route must verify the user. Demo mode, effective user ID, Clerk integration, Supabase RLS.
- Key files: `app/api/**/route.ts`, `lib/demo.ts`, `lib/supabase.ts`, `middleware.ts`
- Look for: API routes missing `getEffectiveUserId()` check, routes that return data without verifying user identity, user ID from one user leaking into another user's query, missing `.eq("clerk_user_id", userId)` filters, demo mode bypassing real auth checks

**4. Data Consistency (DATACONS)**
- Description: Relationships between accounts, transactions, subscriptions, plaid_items. Orphan records, foreign key violations, stale references.
- Key files: `lib/transaction-sync.ts`, `lib/subscription-detect.ts`, `lib/accounts-for-user.ts`, `app/api/subscriptions/route.ts`
- Look for: Transactions referencing deleted accounts, subscriptions pointing to non-existent transactions, upsert conflicts, clerk_user_id mismatches between related tables, delete operations that don't cascade properly

**5. Caching & Staleness (CACHE)**
- Description: Next.js unstable_cache, force-dynamic, revalidation tags, Cache-Control headers, stale data shown to users.
- Key files: `lib/cached-queries.ts`, `app/api/**/route.ts`, any file with `unstable_cache` or `revalidateTag`
- Look for: Cache keys that don't include user ID (data leak between users), missing revalidation after mutations, stale data served after user makes changes, cache TTL too long for financial data, force-dynamic on routes that don't need it

**6. Race Conditions & Concurrency (RACE)**
- Description: Parallel API calls, optimistic updates, state that depends on async operations completing in order.
- Key files: `hooks/useTransactions.ts`, `hooks/useSubscriptions.ts`, `app/app/*/page.tsx`, `app/api/plaid/accounts/route.ts`
- Look for: useEffect dependencies that cause infinite loops or excessive re-fetching, setState after unmount, parallel fetches that overwrite each other, missing AbortController on fetch calls, optimistic updates without rollback on failure

**7. Error Recovery & Resilience (ERRORS)**
- Description: What happens when external services fail (Plaid down, Supabase timeout, OpenAI rate limit). Error boundaries, fallbacks, retry logic.
- Key files: `app/api/**/route.ts`, `lib/transaction-sync.ts`, `lib/search-engine.ts`, `lib/subscription-detect.ts`
- Look for: Empty catch blocks that swallow errors silently, missing try/catch on async operations, errors returned as HTTP 200 OK, error messages leaking internal details (stack traces, SQL, file paths), no timeout on external API calls, unhandled promise rejections

**8. Client-Side State & Loading (UISTATE)**
- Description: Loading states, empty states, error states, skeleton screens, flash of wrong content.
- Key files: `app/app/*/page.tsx`, `hooks/*.ts`, `components/*.tsx`
- Look for: Loading spinners not shown during initial fetch, empty state shown before data loads (flash of incorrect content), error states not handled (blank screen), stale data shown after page navigation, missing loading states on buttons during async operations

**9. Input Validation & Injection (INPUT)**
- Description: User inputs in search, forms, API request bodies. SQL injection via Supabase, XSS via React, prompt injection via OpenAI.
- Key files: `app/api/**/route.ts`, `lib/search-engine.ts`, `app/app/shared/page.tsx`, `app/app/settings/page.tsx`
- Look for: User input passed directly to `.ilike()` or `.or()` without sanitization, `dangerouslySetInnerHTML` usage, user input concatenated into OpenAI prompts without escaping, missing request body validation on POST/PATCH routes, missing Content-Type checks

**10. TypeScript Safety & Runtime Mismatches (TYPES)**
- Description: Type assertions that lie, `as any`, nullable values used without checks, runtime shapes that don't match TS types.
- Key files: All `.ts` and `.tsx` files — focus on files with `as unknown as`, `as any`, `!` non-null assertions
- Look for: `as` casts that mask null/undefined, Supabase `.select()` results used without null checks, optional chaining missing where data could be null, array methods called on potentially undefined values, JSON.parse without try/catch

---

#### Product Flow Agents (11-12)

These agents think like a **user**, not an engineer. They trace real user journeys across multiple pages and components, checking that each step works correctly and transitions are smooth. They should read the page components, the hooks they use, and the API routes they call — following the entire chain from click to rendered result.

**11. New User Onboarding Flow (ONBOARD)**
- Description: Trace the complete first-time user experience from sign-up through seeing their financial data. This is the most critical flow — if onboarding is broken, users churn immediately.
- Key files: `app/connect/page.tsx`, `app/api/plaid/create-link-token/route.ts`, `app/api/plaid/exchange-token/route.ts`, `app/api/plaid/accounts/route.ts`, `lib/transaction-sync.ts`, `app/app/dashboard/page.tsx`, `app/app/transactions/page.tsx`
- Look for — trace this exact journey:
  1. **User signs up** → Are they redirected to the connect page? What if they navigate directly to `/app/dashboard` before connecting?
  2. **User clicks "Connect Bank"** → Does Plaid Link initialize correctly? What if `create-link-token` fails?
  3. **Plaid Link completes** → Does `exchange-token` fire? What happens if it fails mid-exchange? Is the user stuck?
  4. **Token exchanged** → Does the first sync trigger? What does the user see while syncing? Is there a loading state or do they see "No transactions"?
  5. **Sync completes** → Does the dashboard show data immediately, or does the user need to refresh? Do accounts appear in the sidebar/settings?
  6. **User navigates to Transactions** → Are transactions visible? Is there a flash of "No transactions found" before data loads?
  7. **User navigates to Subscriptions** → Does detection trigger? What does the user see the first time (before any detection has run)?
  - Report any step where the user would see an error, empty state, or confusing UI during this happy path.

**12. Returning User Daily Flow (DAILY)**
- Description: Trace the daily experience of a returning user with an already-connected bank. Cross-page state consistency, navigation, data freshness.
- Key files: `app/app/dashboard/page.tsx`, `app/app/transactions/page.tsx`, `app/app/subscriptions/page.tsx`, `app/app/shared/page.tsx`, `app/app/email-receipts/page.tsx`, `app/app/settings/page.tsx`, `hooks/useTransactions.ts`, `hooks/useSubscriptions.ts`
- Look for — trace these journeys:
  1. **Dashboard loads** → Does the spending chart show current month data? What if the user has no transactions this month — does it handle empty gracefully or show NaN/$0.00 confusingly?
  2. **User clicks into Transactions** → Does the transaction list load without flash? Does search work? Does filtering by account work? What if they search for a merchant that doesn't exist?
  3. **User checks Subscriptions** → Do subscriptions load? Does "Detect subscriptions" button work? What happens after detection — does the list update without a page reload?
  4. **User visits Shared Expenses** → Does the page load correctly with connected bank? Can they add an expense? Does the split calculation work? What happens with 0 participants?
  5. **User goes to Settings** → Does their connected bank show? Does changing currency persist and update across all other pages immediately?
  6. **User changes currency in Settings, then navigates back to Dashboard** → Are all amounts in the new currency? Or is there stale state showing old currency?
  7. **Navigation between pages** → Does the back button work? Does data refetch or show stale? If the user quickly navigates between pages, does anything break?
  - Focus on CROSS-PAGE inconsistencies: state set on one page not reflecting on another, stale data after mutations, navigation causing unexpected resets.

---

## Phase 2: Triage

After ALL 12 agents return their reports:

1. **Collect all bugs** into a single master list. Print the full list to the user so they can see what was found.

2. **Deduplicate**: If two agents found the same underlying bug (e.g., UISTATE and ONBOARD both found the loading flash), merge into one entry. Keep the more detailed proposed fix. Note which agents independently found it (this increases confidence it's real).

3. **Filter out non-fixable bugs**:
   - Bugs with `Requires: migration` → move to "Reported but not fixed" section
   - Bugs with `Requires: product-decision` → move to "Reported but not fixed" section
   - Only bugs with `Requires: code-only` proceed to Phase 3

4. **Check for file conflicts**: If two bugs require modifying the same file, note it. These fixes must run sequentially in Phase 3.

5. **Build the Fix Queue**: Order by priority:
   - P0 (data loss / security) first
   - P1 (broken functionality) second
   - P2 (incorrect behavior) third
   - P3 (cosmetic / minor) last
   - Within same priority, prefer lower-risk fixes first

6. **Print the fix queue** to the user before proceeding. Format:
   ```
   === FIX QUEUE ({N} bugs) ===
   1. [P0] BUG-AUTH-1: Missing auth check on /api/foo — auth/route.ts
   2. [P1] BUG-ONBOARD-2: Empty state flash after bank connect — dashboard/page.tsx
   ...

   === NOT FIXING ({M} bugs) ===
   - [P1] BUG-DATACONS-3: Orphan records need cleanup (requires migration)
   - [P2] BUG-DAILY-1: Currency change needs page reload (needs product decision)
   ```

---

## Phase 3: Fix

For each bug in the fix queue, spawn a **Fixer Agent** using the Task tool (subagent_type "general-purpose").

### Fixer Agent Prompt Template

Each fixer agent receives:

```
You are a Bug Fixer agent. Your job is to implement ONE specific bug fix.

## Bug Report
{paste the full bug report here, including BUG-ID, severity, file, lines, description, proposed fix, and risk}

## Instructions
1. Read the file(s) mentioned in the bug report to understand the current state of the code.
2. Implement the proposed fix. If the proposed fix is unclear or would introduce new issues, use your judgment to implement a correct minimal fix.
3. ONLY change what is necessary to fix this specific bug. Do not refactor surrounding code, add comments, or make unrelated improvements.
4. After making the edit(s), stage the changed files and commit with this exact message format:
   ```
   fix({DOMAIN_CODE}): {bug title}

   {One-line description of what was changed and why}

   Bug-ID: BUG-{DOMAIN_CODE}-{N}
   Severity: {P0|P1|P2|P3}

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```
5. Do NOT push. Do NOT create a PR. Just commit locally.
6. If the fix cannot be safely implemented (e.g., it would require changes outside the scope described, or the proposed fix is wrong), respond with "SKIP: {reason}" and do NOT commit anything.
```

### Execution Strategy

- **Non-overlapping fixes** (different files): spawn fixer agents **in parallel** for speed.
- **Overlapping fixes** (same file): run those fixer agents **sequentially** to prevent edit conflicts.
- Group fixes by file, then within each group run sequentially, while running different file-groups in parallel.

### Post-Fix Verification

After ALL fixer agents complete:

1. Run `npx tsc --noEmit` to check for type errors. If any new errors appear, identify which commit introduced them and revert it with `git revert --no-edit <sha>`.

2. Run `npx vitest run --reporter=verbose 2>&1 | tail -50` to check existing tests still pass. If a test fails due to a fix, evaluate whether the test was wrong (testing buggy behavior) or the fix was wrong. If the fix was wrong, revert it.

3. Run `git log --oneline fix/bug-council-$(date +%Y%m%d)..HEAD` to get the final list of commits that survived verification.

---

## Phase 4: Create PR

Create a single pull request with:

```
gh pr create --title "fix: bug council audit — {N} bugs fixed" --body "$(cat <<'EOF'
## Bug Council Audit Results

**Agents deployed**: 12 (10 technical + 2 product flow)
**Bugs found**: {total found}
**Bugs fixed**: {total fixed}
**Bugs deferred**: {total not fixed}

## Fixed Bugs

### P0 — Critical
{list or "None"}

### P1 — Broken Functionality
{list each: - **BUG-ID**: description (file)}

### P2 — Incorrect Behavior
{list each}

### P3 — Cosmetic
{list each}

## Deferred Bugs (Not Fixed)

{For each unfixed bug: - **BUG-ID** [severity]: description — reason not fixed}

## Verification
- [x] `tsc --noEmit` passes
- [x] `vitest run` passes
- [ ] Manual smoke test of affected flows

## Agents That Found No Bugs
{list domains that reported CLEAN}

---
Generated by Bug Council skill
EOF
)"
```

---

## Important Constraints

- Do NOT refactor code that isn't buggy
- Do NOT add features
- Do NOT change code style or formatting
- Do NOT add comments, documentation, or type annotations to code you didn't change
- Do NOT modify test files unless there's an actual bug in the test
- Each fix must be the minimum change necessary to fix the bug
- If a bug requires a database migration, report it but do NOT fix it (flag as "requires migration")
- If a bug requires a product/design decision, report it but do NOT fix it (flag as "needs product decision")
- All fixes go on ONE branch, ONE PR. Not per-bug or per-agent.
