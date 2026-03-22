# Vercel Environment Variables Checklist

Add these to your **coconut** project in Vercel → Settings → Environment Variables.

## Required for app + Plaid to work

| Variable | Value | You have? |
|----------|-------|-----------|
| `PLAID_ENV` | `production` | ❌ **ADD THIS** — without it, backend uses sandbox and ignores PLAID_PRODUCTION_SECRET |
| `PLAID_CLIENT_ID` | (from Plaid Dashboard) | ✓ |
| `PLAID_PRODUCTION_SECRET` | (starts with `pls_production_`) | ✓ |
| `APP_URL` | `https://coconut-app.dev` | Add if missing — needed for Plaid redirect URI |

## Auth + DB (you have these)

- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
- CLERK_SECRET_KEY
- NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY

## After adding PLAID_ENV

1. Redeploy: Vercel → Deployments → Redeploy latest
2. Rebuild app: `cd coconut-app && npx expo run:ios --device`
