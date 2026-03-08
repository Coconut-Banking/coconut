# Coconut — Project Spec

Personal finance app (like Rocket Money): transactions, natural-language search, receipt splitting, shared groups, subscriptions, Plaid integration.

## Stack

- **Framework**: Next.js 16 (App Router)
- **Auth**: Clerk
- **DB**: Supabase (Postgres)
- **Payments**: Stripe (webhooks, Terminal for Tap to Pay)
- **Banking**: Plaid
- **Mobile**: Separate repo `coconut-app` (Expo) — this repo is web only

## Key paths

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/app/` | Main app shell (dashboard, transactions, shared, subscriptions, receipts) |
| `app/api/` | API routes (Plaid, Stripe, groups, subscriptions, etc.) |
| `lib/` | Business logic (subscription-detect, nl-query, plaid-client, etc.) |
| `hooks/` | React hooks (useTransactions, useSubscriptions, useNLSearch) |
| `components/` | Shared UI |
| `docs/` | Migrations (`supabase-migration-*.sql`), architecture notes |
| `e2e/` | Playwright E2E tests |

## Conventions

- **Imports**: Use `@/` alias (e.g. `import { x } from "@/lib/..."`)
- **API routes**: `app/api/[resource]/route.ts` or `app/api/[resource]/[id]/route.ts`
- **Styling**: Tailwind; primary green `#3D8E62` / `bg-[#3D8E62]`
- **Migrations**: Add SQL files to `docs/`; run manually in Supabase

## Validation commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest (unit)
npm run test:e2e    # playwright (optional, slower)
```
