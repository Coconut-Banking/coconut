# Plaid Webhook Setup

The app receives Plaid webhooks at `POST /api/plaid/webhook` for events like new accounts, login required, etc.

## Webhook URL

- **Production:** `https://<your-domain>/api/plaid/webhook`
- **Local:** `https://<your-ngrok-or-tunnel>/api/plaid/webhook` (Plaid cannot reach localhost)

New Items get the webhook URL automatically when created via Link. For Items created before this was added, set the **team default webhook** in Plaid Dashboard.

## Plaid Dashboard

1. Go to [Plaid Dashboard](https://dashboard.plaid.com) → **Team Settings** → **Webhooks**
2. Add your webhook URL (e.g. `https://coconut-lemon.vercel.app/api/plaid/webhook`)
3. Save

## Test in Sandbox

Use Plaid's sandbox to fire a test webhook:

```bash
# Replace ACCESS_TOKEN with a sandbox Item access_token
curl -X POST https://sandbox.plaid.com/sandbox/item/fire_webhook \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "<PLAID_CLIENT_ID>",
    "secret": "<PLAID_SANDBOX_SECRET>",
    "access_token": "<ACCESS_TOKEN>",
    "webhook_code": "NEW_ACCOUNTS_AVAILABLE"
  }'
```

Or use the Plaid API reference / Sandbox tools in the Dashboard.

## Handled Webhooks

| webhook_type | webhook_code | Action |
|--------------|--------------|--------|
| TRANSACTIONS | SYNC_UPDATES_AVAILABLE | Sync transactions (Plaid's recommended flow for transaction updates) |
| ITEM | NEW_ACCOUNTS_AVAILABLE | Set new_accounts_available; sync; show "Add new accounts" prompt |
| ITEM | ERROR (ITEM_LOGIN_REQUIRED) | Set needs_reauth; show banner and Settings link |
| ITEM | PENDING_EXPIRATION | Set needs_reauth |
| ITEM | PENDING_DISCONNECT | Set needs_reauth |
| ITEM | LOGIN_REPAIRED | Clear needs_reauth, sync transactions |
| ITEM | USER_PERMISSION_REVOKED | Log |
| ITEM | USER_ACCOUNT_REVOKED | Log |

## Verification

Webhooks are verified via the `Plaid-Verification` JWT header when present. If verification fails, the request is rejected with 401.
