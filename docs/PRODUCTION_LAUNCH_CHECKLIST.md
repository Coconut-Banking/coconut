# Production launch checklist

Before going live with real users and real bank connections:

1. **Plaid** — [PLAID_PRODUCTION_CHECKLIST.md](PLAID_PRODUCTION_CHECKLIST.md): production keys, privacy policy, pre-Link consent, `PLAID_ENV=production`, redirect URIs.
2. **Vercel / env** — [VERCEL_ENV_CHECKLIST.md](VERCEL_ENV_CHECKLIST.md): all required env vars (Clerk, Supabase, Plaid production, Stripe, `APP_URL`, webhooks).
3. **Privacy & terms** — Publish privacy policy and terms; link from Settings and from any consent screen before Plaid Link.
4. **RLS** — Run [supabase-migration-rls-policies.sql](supabase-migration-rls-policies.sql) and [supabase-migration-rls-subscriptions-receipts.sql](supabase-migration-rls-subscriptions-receipts.sql) in Supabase if using user-scoped client with Clerk JWT.
