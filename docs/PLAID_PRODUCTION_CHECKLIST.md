# Plaid Production Checklist

Before launching to real customers, ensure these are addressed.

## 1. Store Production access tokens ✓

- Access tokens are stored in `plaid_items` with `clerk_user_id`
- Tokens are associated with the user whose data they represent
- **Note:** Tokens are stored in Supabase (TLS in transit, encryption at rest). For higher security, consider application-level encryption of the `access_token` column (see SECURITY_AUDIT.md).

## 2. Provide required notices and obtain consent

- **Current:** Settings has a "Data privacy" section and "Read our full privacy policy" link
- **TODO:** Ensure you have:
  - A live privacy policy page that covers Plaid data usage
  - Pre-Link consent/notice as required by your Plaid MSA and applicable law
  - Compliance with your jurisdiction (e.g., GLBA, CCPA)

## 3. Store sensitive user data appropriately ✓

- Plaid data (transactions, accounts) stored in Supabase
- Supabase provides TLS and encryption at rest
- RLS policies and service-role access control in place

## 4. Remove Sandbox calls ✓

- **Fixed:** `/api/plaid/debug` skips sandbox API calls when `PLAID_ENV=production`
- Main app uses `PLAID_ENV` to select production vs sandbox — no `/sandbox/` endpoints in production data flows

## 5. Switch to Production server and API keys

**Vercel env (production):**

| Variable | Value |
|----------|-------|
| `PLAID_ENV` | `production` |
| `PLAID_CLIENT_ID` | From Plaid Dashboard |
| `PLAID_PRODUCTION_SECRET` | `pls_production_...` |
| `APP_URL` | Your production URL |

See `docs/VERCEL_ENV_CHECKLIST.md` for full setup. After adding `PLAID_ENV=production`, redeploy.
