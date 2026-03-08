# Agent guardrails for coconut-ai-worker

This file guides autonomous agents (e.g. coconut-ai-worker) that implement changes and open PRs.

## Required validation (must pass before PR)

All of these must succeed. No PR is opened if any fails:

1. **`npm run typecheck`** — TypeScript compiles with no errors
2. **`npm run lint`** — ESLint passes
3. **`npm run test`** — Unit tests (vitest) pass

Do **not** skip or disable these. Fix issues instead.

## Optional (slow) validation

- **`npm run test:e2e`** — Playwright E2E tests. May be slow; run locally before merge if changes touch critical flows (auth, receipt split, shared).

## What to avoid

- **Never** push directly to `main`
- **Never** auto-merge PRs
- **Never** commit without running typecheck, lint, and test
- **Never** add `// @ts-ignore` or `eslint-disable` to bypass errors without clear justification
- **Never** modify `.env.local` or commit secrets

## Commit format

Use conventional commits: `feat:`, `fix:`, `refactor:`, etc. For issue-driven work: `feat: implement issue #123` or similar.

## Sensitive areas

- **Auth** (Clerk): Be careful with sign-in/sign-out flows
- **Plaid**: Transaction sync, bank linking — test with mock/sandbox
- **Stripe**: Payments, Terminal — use test mode
- **Supabase**: Migrations go in `docs/supabase-migration-*.sql`; do not auto-run against production
