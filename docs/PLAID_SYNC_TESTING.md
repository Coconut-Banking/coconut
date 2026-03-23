# Plaid transaction sync — accuracy, staleness, and how to test

## How data is supposed to flow

1. **Link** (`/connect`) saves `plaid_items` + encrypted access token.
2. **`/transactions/sync`** (Plaid) is called from **`syncTransactionsForUser`** (`lib/transaction-sync.ts`): upserts rows into **`transactions`**, deletes Plaid-removed txs.
3. **Mobile / web “load”** reads **`GET /api/plaid/transactions`** from **Supabase** (not Plaid directly). So the UI is only as fresh as the **last successful sync**.
4. **Freshness triggers**
   - **Webhooks** → `POST /api/plaid/webhook` → sync for `SYNC_UPDATES_AVAILABLE`, **`INITIAL_UPDATE`**, **`HISTORICAL_UPDATE`** (all trigger a sync).
   - **Sync-on-read** → if you’re linked but `transactions` is empty, **`GET /api/plaid/transactions`** may run **one** sync (rate-limited 1 / 90s per user).
   - **Manual** → **`POST /api/plaid/transactions`** or app **pull-to-refresh** (runs POST then refetches).

If webhooks are wrong, blocked, or the Item row is missing (`item not found` in logs), data can lag until a **manual sync**.

---

## Quick health check (signed in)

Open (same browser session as the app, or use a Bearer token from the mobile app):

```text
GET https://YOUR_DOMAIN/api/plaid/sync-diagnostics
```

Response includes:

- **`linked`** / **`items`** — Plaid connections and `needs_reauth`.
- **`transactions.bank_row_count`**, **`latest_bank_date`**, **`pending_count`**, **`oldest_bank_date`**.
- **`hints`** — short interpretation.

Optional (slow — hits Plaid):

```text
GET https://YOUR_DOMAIN/api/plaid/sync-diagnostics?sync=1
```

---

## Manual tests

| Step | What to verify |
|------|----------------|
| 1. Link bank | `sync-diagnostics` shows `linked: true`, items listed. |
| 2. After link | Within a few minutes, `bank_row_count` &gt; 0 and `latest_bank_date` recent; or pull-to-refresh on mobile. |
| 3. New purchase | After Plaid processes it, webhook or pull-to-refresh; `latest_bank_date` or pending count updates. |
| 4. Vercel logs | `[plaid][webhook] TRANSACTIONS sync` with `webhook_code` — not only `item not found`. |
| 5. Plaid Dashboard | **Developers → Webhooks** — URL **`https://YOUR_DOMAIN/api/plaid/webhook`**, same env (production/sandbox) as `PLAID_ENV`. |

---

## Common “stale / wrong” causes

| Symptom | Likely cause |
|---------|----------------|
| `item not found` in webhook logs | Exchange-token never saved the row (e.g. `TOKEN_ENCRYPTION_KEY`), or wrong Plaid env. |
| Linked but 0 transactions | No sync yet — pull-to-refresh once; check webhooks. |
| `needs_reauth: true` | Bank needs re-link (**Settings → Fix connection** on web). |
| Very slow loads | `GET /api/plaid/transactions` does DB work + optional LLM normalization; **POST** sync is heavy — use pull-to-refresh intentionally. |

---

## Worst case: reset data

If you’re fine wiping **your** user data in Supabase:

1. Delete rows for your `clerk_user_id` in `transactions`, `accounts`, `plaid_items` (and related) **or** use a fresh Supabase branch.
2. Re-link bank on `/connect`.
3. Confirm webhooks + `sync-diagnostics` again.

Do **not** delete production multi-user data without a backup.

---

## Related code

- `lib/transaction-sync.ts` — `syncTransactionsForUser`, `transactionsSync` loop.
- `app/api/plaid/webhook/route.ts` — webhook → sync.
- `app/api/plaid/transactions/route.ts` — `GET` (read + optional sync-on-read), `POST` (full sync).
- `hooks/useTransactions.ts` (mobile) — status → GET; `runFullSync` → POST + GET.
