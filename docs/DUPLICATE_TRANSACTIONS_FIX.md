# SEV0: Duplicate Transactions — Root Cause & Fix

## Problem

Transactions appeared many times (e.g. The Melt 11×, Chipotle 10×, Mendocino Farms 12×). Same merchant, amount, and date repeated across Food & Drink.

## Root Cause

1. **Multiple Plaid Items for same bank**: When a user reconnects a bank ("Fix connection") or links the same institution again, Plaid creates a new Item. The same real transactions then come back with **different `transaction_id`s** per Item.
2. **No sync-time deduplication**: `syncTransactionsForUser` iterates over all access tokens and upserts by `plaid_transaction_id`. Each distinct Plaid ID creates a new row — so the same real tx from different Items was inserted multiple times.
3. **API dedupe was limited**: The GET handler deduped by `merchant|amount|date` and deleted dupes, but only for the first 2000 rows. Users with more transactions never got full cleanup.

## Fixes Implemented

### 1. Sync-time deduplication (`lib/transaction-sync.ts`)

Before upserting, we filter out rows that would duplicate an existing transaction:

- Fetch existing `(normalized_merchant, amount, date)` for the user
- Skip inserting any row whose key already exists
- Prevents new duplicates from multi-Item syncs

### 2. Post-sync full cleanup (`lib/transaction-sync.ts`)

After each sync, we run `deleteDuplicateTransactionsForUser`:

- Paginates through all transactions (2000 per page)
- Keeps first occurrence per `(normalized_merchant, amount, date)`
- Deletes duplicates in batches of 100
- Protects rows referenced by `split_transactions` or `email_receipts`

### 3. Stronger API dedupe (`app/api/plaid/transactions/route.ts`)

- Uses `normalized_merchant` when available for better matching
- Calls `revalidateTag` after deleting duplicates so cache is invalidated

### 4. Full-scan in cached query (`lib/cached-queries.ts`)

- `fetchTransactions` now selects `normalized_merchant` for dedupe key consistency

## How to Clean Existing Duplicates

- **Automatic**: Trigger a sync (pull-to-refresh or Settings → Sync). Post-sync cleanup will remove existing duplicates.
- **Manual SQL** (optional, for emergency one-off run in Supabase SQL Editor):

```sql
-- One-time cleanup: delete duplicate transactions (keeps first by id)
-- Skip rows in split_transactions or email_receipts
WITH dupes AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY clerk_user_id,
        lower(trim(coalesce(normalized_merchant, coalesce(merchant_name, raw_name, '')))),
        amount,
        date
      ORDER BY id
    ) AS rn
  FROM transactions
  WHERE plaid_transaction_id NOT LIKE 'manual_%'
),
to_delete AS (
  SELECT dupes.id
  FROM dupes
  WHERE rn > 1
    AND id NOT IN (SELECT transaction_id FROM split_transactions WHERE transaction_id IS NOT NULL)
    AND id NOT IN (SELECT transaction_id FROM email_receipts WHERE transaction_id IS NOT NULL)
)
DELETE FROM transactions WHERE id IN (SELECT id FROM to_delete);
```

## Plaid Best Practice (Future)

To reduce duplicate Items: before exchanging a link token, check `institution_id` and optionally account name/mask. Reject or merge if the same institution is already linked. See Plaid docs on duplicate institution handling.
