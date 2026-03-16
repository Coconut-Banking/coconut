# Coconut Web App

## Overview
Coconut is a personal finance app. This is the Next.js web app (App Router). The companion mobile app lives in a separate repo (coconut-app, Expo/React Native).

## Tech Stack
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres + Auth helpers)
- Clerk (authentication)
- Plaid (bank account linking, transaction sync)
- Stripe (payments, Terminal)
- Vitest (unit tests), Playwright (E2E tests)
- Deployed on Vercel

## Validation Commands
Run these before creating any PR. All must pass:
1. `npm run typecheck` - TypeScript compilation
2. `npm run lint` - ESLint
3. `npm run test` - Vitest unit tests
4. `npm run build` - Next.js build

## Bug Fixing Rules
- Read AGENTS.md for full guardrails
- Keep fixes minimal and targeted - don't refactor unrelated code
- Match existing patterns in the codebase
- If a test doesn't exist for the buggy code, add one
- Use conventional commits: `fix: description of what was fixed`
- Create PRs against `main`
- Never push directly to `main`, never auto-merge
- Never modify `.env.local` or commit secrets

## Project Structure
- `app/` - Next.js App Router pages and API routes
- `components/` - Reusable React components
- `hooks/` - Custom React hooks
- `lib/` - Utility functions and business logic
- `supabase/` - Database types and migrations
- `e2e/` - Playwright E2E tests
- `docs/` - Implementation guides and specs
