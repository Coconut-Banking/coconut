# Coconut Production Runbook

Operational guide for the Next.js backend (`coconut`) and companion mobile app (`coconut-app`). Use with `.env.example` and `docs/VERCEL_ENV_CHECKLIST.md`.

## Environments

| Environment | Web URL | Mobile API |
|-------------|---------|------------|
| Production | `https://coconut-app.dev` | `EXPO_PUBLIC_API_URL=https://coconut-app.dev` |
| Local | `http://localhost:3000` | Same host or tunnel |

## Pre-deploy checklist

1. **Env vars** — All required vars in Vercel Production (see checklist below).
2. **Supabase migrations** — Apply any new files under `supabase/migrations/` in the Supabase SQL editor (or CLI) **before** deploying code that depends on them.
3. **Do not rely on migration-only Vercel skips** — If only SQL changed, still redeploy or confirm app version matches schema.
4. **Redeploy** — `git push origin main` (pushes to both remotes per project convention).

## Required Vercel variables (production)

### Must have (app breaks or insecure without)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `PLAID_CLIENT_ID`, `PLAID_PRODUCTION_SECRET`, `PLAID_ENV=production`
- `TOKEN_ENCRYPTION_KEY` (32 bytes — Plaid tokens encrypted at rest)
- `APP_URL=https://coconut-app.dev`
- `CRON_SECRET` (Vercel crons return 401 without it)
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `PAY_LINK_SIGNING_KEY`, `COLLECT_LINK_SIGNING_KEY` (or dedicated keys; not Clerk secret)

### Must NOT be set in production

- `ENABLE_DEBUG_ENDPOINTS=true`
- `NEXT_PUBLIC_SKIP_AUTH=true`, `SKIP_AUTH=true`
- `CLERK_DISABLED=true`, `NEXT_PUBLIC_CLERK_DISABLED=true`
- `DEMO_ENABLED=true`

### Strongly recommended

- `CLERK_WEBHOOK_SIGNING_SECRET`
- `OPENAI_API_KEY` (chat, search, receipts)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `GITHUB_BOT_TOKEN` (in-app bug reports)
- `APPLE_TEAM_ID` (universal links)
- `NEXT_PUBLIC_IOS_APP_URL`
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (when integrated)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (optional — enables distributed rate limits on chat, nl-search, Plaid link)
- `REVENUECAT_WEBHOOK_SECRET` (optional — Pro subscriptions; omit while app is free-only)

## Verify crons (after deploy)

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://coconut-app.dev/api/cron/process-jobs"
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://coconut-app.dev/api/cron/receipt-match"
```

Expect JSON success (not 401). In Vercel → Project → Cron Jobs, confirm invocations over 24h.

Scheduled jobs (`vercel.json`):

| Path | Schedule |
|------|----------|
| `/api/cron/process-jobs` | Every minute |
| `/api/cron/receipt-match` | Daily 02:00 UTC |

## Verify health (when `/api/health` exists)

```bash
curl -sS "https://coconut-app.dev/api/health"
```

## Database migrations

1. Source of truth: `supabase/migrations/*.sql` (newest date prefix wins).
2. Legacy one-offs may exist in `docs/supabase-migration-*.sql` — port into `supabase/migrations/` before relying on them in prod.
3. RLS policies: ensure `docs/supabase-migration-rls-policies.sql` is applied if not yet in migrations track.

Record last applied migration in your ops notes (e.g. `20260529_stripe_connect_details_submitted`).

## Mobile release (coconut-app)

1. EAS secrets for all `EXPO_PUBLIC_*` and native keys (never commit).
2. Production build: `eas build --profile production --platform ios`
3. After build, verify IPA entitlements: `aps-environment=production`, associated domains for `coconut-app.dev`.
4. Submit: `eas submit --profile production --platform ios`
5. Rebuild native app after backend breaking API or env changes.

## Rollback

- **Web:** Vercel → Deployments → Promote previous deployment.
- **Mobile:** Ship previous TestFlight build; no OTA until `expo-updates` is configured.
- **DB:** Migrations are forward-only; keep rollback SQL scripts for destructive changes.

## Incident response

1. Check Sentry (when enabled) and Vercel function logs.
2. Confirm crons not 401 (missing `CRON_SECRET`).
3. Confirm `PLAID_ENV=production` if bank linking fails after Link UI succeeds.
4. Confirm `TOKEN_ENCRYPTION_KEY` set if Plaid exchange fails with encryption errors.

## Related docs

- `docs/VERCEL_ENV_CHECKLIST.md` — variable-by-variable checklist
- `docs/SECURITY_AUDIT.md` — historical findings (verify against current code)
- `AGENTS.md` — validation commands before PR
