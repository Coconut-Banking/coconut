# Agent guardrails for coconut-ai-worker

This file guides autonomous agents (e.g. coconut-ai-worker) that implement changes and open PRs. Read `docs/IMPLEMENTATION_GUIDE.md` for patterns and mindset. Read `PROJECT_SPEC.md` for structure and design.

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

## UI and design

All new or modified UI must match the existing theme. Keep it **modern and polished**.

- **Primary color**: `#3D8E62` (buttons, links, accents, active states)
- **Hover**: `#2D7A52` (darker green for buttons)
- **Light green**: `#EEF7F2` (backgrounds), `#C3E0D3` (borders)
- **Cards**: `bg-white rounded-2xl border border-gray-100`, generous padding
- **Inputs**: `rounded-xl border border-gray-200`, focus `ring-2 ring-[#3D8E62]/20`
- **Buttons (primary)**: `bg-[#3D8E62] hover:bg-[#2D7A52] text-white rounded-xl px-5 py-2.5`
- **Rounded corners**: `rounded-xl` (medium), `rounded-2xl` (cards/containers)
- **Font**: Inter (system default)
- **Typography**: Clean hierarchy; avoid generic gray-on-white. Use the green accent for interactive elements.
- **Spacing**: Consistent gaps (`gap-4`, `gap-6`), padding (`p-4`, `p-6`)
- **Motion**: Use `motion/react` for subtle animations (e.g. `motion.div` with `initial`/`animate`) where it improves UX — but don't overdo it.

Do **not** introduce new color schemes, generic Bootstrap-style UI, or cluttered layouts. Match existing pages (dashboard, transactions, settings) in tone and structure.

## Execution mindset

Act like a senior engineer in Cursor: read first, plan, then code. Reuse existing patterns. Keep diffs minimal. Add tests for new logic. If validation fails, fix the code — don't disable checks.

## Workflow modes (optional)

For higher rigor, you can ask the agent to use a specific mode (see `.cursor/rules/gstack-workflow.mdc`):

- **Plan / CEO review** — Pressure-test the idea; find the 10-star product, not just the obvious feature.
- **Plan-eng / architecture** — Nail boundaries, data flow, failure modes, diagrams before coding.
- **Review / paranoid review** — Production-safety pass: races, N+1, trust boundaries, missing tests.
- **Ship** — Final mile only: sync main, run checks, push or open PR; no new scope.
- **QA** — Run the app or E2E; test critical paths and report what passed or failed.

## Sensitive areas

- **Auth** (Clerk): Be careful with sign-in/sign-out flows
- **Plaid**: Transaction sync, bank linking — test with mock/sandbox
- **Stripe**: Payments, Terminal — use test mode
- **Supabase**: Migrations go in `docs/supabase-migration-*.sql`; do not auto-run against production
