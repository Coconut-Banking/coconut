# Bug Council — Known False Positives (do NOT fix or open PRs for these)

Read this file during Phase 2 (Devil's Advocate) and before every fix. If the reported bug matches an entry below, **DISPROVE** it unless you prove main still lacks the fix with `git show origin/main:path`.

## Mobile (coconut-app)

### Stripe Tap to Pay amount is "dollars not cents"
- **Wrong fix**: Sending `Math.round(amt * 100)` in the mobile request body to `POST /api/stripe/terminal/create-payment-intent`.
- **Reality**: The **backend** (`coconut` repo) converts dollars → cents (`amountCents = Math.round(amount * 100)`). Mobile should send **dollars** (e.g. `10.50`), same as `lockedAmount` in `pay.tsx`.
- **Verify**: `grep -n "amountCents" ../coconut/app/api/stripe/terminal/create-payment-intent/route.ts` (or read the API route).

### Missing withTimeout on sign-up
- **Verify first**: `grep withTimeout app/(auth)/sign-up.tsx` — main already wraps Google + email flows with `SIGN_IN_TIMEOUT_MS` / `SIGN_UP_TIMEOUT_MS`.

### saveAssignments does not check res.ok
- **Verify first**: `grep "res.ok" hooks/useReceiptSplit.ts` inside `saveAssignments`.

### Terminal connection token uses empty Authorization
- **Verify first**: Read `components/StripeTerminalRoot.tsx` (not legacy `_layout.tsx`) — must throw if no bearer and check `res.ok` before `json()`.

### Hardcoded Clerk pk_test in app.config.js
- **Verify first**: `app.config.js` should use `process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` only — no `|| "pk_test_..."` fallback on main.

### Unused Alert import
- Adding `import { Alert } from "react-native"` without any `Alert.` usage is not a bug fix — reject.

### package-lock.json–only changes
- Never commit registry URL churn (npmmirror, etc.) or lockfile-only diffs — **SKIP** the PR.

## Web (coconut)

### Shadow / mirror Splitwise parity
- Parity cron, `splitwise-shadow`, and `/api/debug/splitwise-mirror/*` were removed intentionally. Do not reintroduce.

### res.ok before res.json
- Many routes already follow the pattern; grep the specific file on **main** before reporting.
