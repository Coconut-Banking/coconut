# Vercel Environment Variables Checklist

Add these in **coconut** → Vercel → Settings → Environment Variables → **Production**.

Mark each when set. See `.env.example` for descriptions and generation commands.

## Core (required)

| Variable | Production value | Set? |
|----------|------------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ☐ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ☐ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role | ☐ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable | ☐ |
| `CLERK_SECRET_KEY` | Clerk secret | ☐ |
| `APP_URL` | `https://coconut-app.dev` | ☐ |
| `PLAID_CLIENT_ID` | Plaid dashboard | ☐ |
| `PLAID_PRODUCTION_SECRET` | `pls_production_*` | ☐ |
| `PLAID_ENV` | **`production`** | ☐ |
| `TOKEN_ENCRYPTION_KEY` | 32-byte key (`openssl rand -hex 32`) | ☐ |

Without `PLAID_ENV=production`, production secret is ignored and bank linking uses sandbox behavior.

## Crons & webhooks (required for production behavior)

| Variable | Notes | Set? |
|----------|-------|------|
| `CRON_SECRET` | `openssl rand -hex 32` — Vercel crons auth | ☐ |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard webhook | ☐ |
| `REVENUECAT_WEBHOOK_SECRET` | Optional — only when enabling paid Pro | ☐ |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk user lifecycle webhooks | ☐ |

## Payments & signed links

| Variable | Notes | Set? |
|----------|-------|------|
| `STRIPE_SECRET_KEY` | Live or test per environment | ☐ |
| `STRIPE_PUBLISHABLE_KEY` | For Connect embedded / mobile | ☐ |
| `PAY_LINK_SIGNING_KEY` | Dedicated; not `CLERK_SECRET_KEY` | ☐ |
| `COLLECT_LINK_SIGNING_KEY` | Dedicated; can match pay key in dev only | ☐ |
| `STRIPE_WEBHOOK_SECRET_THIN` | Optional second Stripe endpoint | ☐ |

## Gmail receipts (if enabled)

| Variable | Value |
|----------|--------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | |
| `GOOGLE_REDIRECT_URI` | `https://coconut-app.dev/api/gmail/callback` |

Add the same redirect URI in Google Cloud Console → Credentials → OAuth client.

## Mobile & links

| Variable | Notes | Set? |
|----------|-------|------|
| `APPLE_TEAM_ID` | Universal links (`942BUGUD75`) | ☐ |
| `NEXT_PUBLIC_IOS_APP_URL` | App Store / TestFlight URL | ☐ |
| `NEXT_PUBLIC_APP_URL` | Optional; metadata / absolute links | ☐ |

## Optional features

| Variable | When needed |
|----------|-------------|
| `OPENAI_API_KEY` | Chat, NL search, receipt parse |
| `SPLITWISE_CLIENT_ID` / `SPLITWISE_CLIENT_SECRET` | Splitwise import |
| `SPLITWISE_REDIRECT_URI` | Must match Splitwise OAuth app exactly |
| `GITHUB_BOT_TOKEN` | In-app bug reports |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | Telegram bug bot |
| `AUTO_PAYOUT_ENABLED` | Default on; set `false` to disable globally |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring |

## Production safety — must be unset or false

| Variable | Risk if set |
|----------|-------------|
| `ENABLE_DEBUG_ENDPOINTS` | Exposes `/api/debug/*` |
| `NEXT_PUBLIC_SKIP_AUTH` / `SKIP_AUTH` | Bypasses auth (dev only) |
| `CLERK_DISABLED` / `NEXT_PUBLIC_CLERK_DISABLED` | Broken auth state |
| `DEMO_ENABLED` | Demo API in non-prod only; never in prod |

## After changes

1. **Redeploy** — Vercel → Deployments → Redeploy latest.
2. **Verify crons** — See `docs/PRODUCTION_RUNBOOK.md`.
3. **Rebuild iOS app** if API URL or auth-related public env changed:
   ```bash
   cd coconut-app && npx expo run:ios --device
   ```

## Quick verification

```bash
# Crons (replace with your CRON_SECRET)
curl -H "Authorization: Bearer $CRON_SECRET" https://coconut-app.dev/api/cron/process-jobs

# Plaid status (signed-in session required in browser)
# Open https://coconut-app.dev/app after linking bank
```
