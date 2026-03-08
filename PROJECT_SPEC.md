# Coconut — Project Spec

Personal finance app (like Rocket Money). For implementation patterns, see `docs/IMPLEMENTATION_GUIDE.md`.: transactions, natural-language search, receipt splitting, shared groups, subscriptions, Plaid integration.

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
- **Migrations**: Add SQL files to `docs/`; run manually in Supabase

## Design system (match this exactly for new UI)

| Element | Classes / values |
|---------|------------------|
| Primary | `#3D8E62` |
| Primary hover | `#2D7A52` |
| Light green bg | `#EEF7F2` |
| Green border | `#C3E0D3` |
| Card | `bg-white rounded-2xl border border-gray-100 p-6` |
| Button primary | `bg-[#3D8E62] hover:bg-[#2D7A52] text-white rounded-xl px-5 py-2.5` |
| Input | `rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#3D8E62]/20` |
| Font | Inter (globals.css) |
| Motion | `motion/react` for subtle animations |

## Validation commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run test        # vitest (unit)
npm run test:e2e    # playwright (optional, slower)
```
