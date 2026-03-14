# User Offboarding & Data Retention

Coconut follows Plaid's offboarding recommendations and data retention best practices.

## item/remove flows

We call Plaid `item/remove` whenever an Item is no longer needed:

| Flow | When | Action |
|------|------|--------|
| **Disconnect** | User taps "Disconnect bank" in Settings | item/remove per Item → delete bank transactions, accounts, plaid_items |
| **Wipe** | User taps "Wipe all data" in Settings | item/remove per Item → delete all transactions, accounts, plaid_items, subscriptions |
| **Account deletion** | User deletes account via Clerk | Clerk `user.deleted` webhook → offboardUser() → item/remove + delete all data |

## Data retention

When a user disconnects or deletes their account:

- **Plaid Items** — We call `item/remove` so Plaid stops billing and invalidates tokens
- **Transactions** — Deleted (disconnect: bank only; wipe/deletion: all)
- **Accounts** — Deleted
- **Groups** — On account deletion, groups owned by the user are deleted (cascade to members, splits, settlements)
- **Gmail / email receipts** — Deleted on full offboard

## Clerk webhook setup

For account deletion offboarding:

1. **Clerk Dashboard** → Webhooks → Add endpoint
2. **Endpoint URL:** `https://<your-domain>/api/webhooks/clerk`
3. **Subscribe to:** `user.deleted`
4. **Signing secret:** Add `CLERK_WEBHOOK_SIGNING_SECRET` to your env (copy from endpoint settings)

## Shared logic

`lib/offboard-user.ts` centralizes the full offboard flow (item/remove + data deletion). The Clerk webhook uses this when a user deletes their account.
