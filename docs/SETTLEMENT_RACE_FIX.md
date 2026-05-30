# Settlement race fix (over-settlement on double-tap)

## Problem

`POST /api/settlements` used to:

1. Read pairwise balance in Node (`getMaxSettlementAllowed`)
2. Insert via `insert_settlement_checked` (membership check only)

Two parallel requests could both read the same remaining balance before either INSERT committed → **over-settlement**.

## Fix (migration `20260602_settlement_balance_cap_rpc.sql`)

1. **`get_pairwise_settlement_max`** — SQL version of `computePairwiseBalance(receiver, payer)` with Splitwise dedupe rules.
2. **`insert_settlement_checked`** — inside one transaction:
   - `pg_advisory_xact_lock` on `(group, payer, receiver, currency)` — serializes concurrent inserts for the same pair
   - Recompute `v_max` from current DB rows
   - `INSERT` `LEAST(requested_amount, v_max)` only
   - Return `400`-style JSON `{ error, max_amount }` if nothing left

The API route still calls `getMaxSettlementAllowed` first for a fast rejection; the RPC is the **source of truth**.

## Stripe path

`lib/stripe-settlement-record.ts` uses **`insert_stripe_settlement_checked`** (migration `20260603_stripe_settlement_cap_rpc.sql`): same lock + cap, plus idempotent `external_reference` and `ON CONFLICT` for duplicate webhooks.

## Apply in Supabase

Run in order (you applied `20260601` + `20260602`; **still run `20260603` for Stripe/Tap to Pay**):

```text
supabase/migrations/20260601_settlements_external_reference_unique.sql
supabase/migrations/20260602_settlement_balance_cap_rpc.sql
supabase/migrations/20260603_stripe_settlement_cap_rpc.sql   ← required for Stripe path
```

## Verify

1. Two tabs: mark paid $50 twice quickly on the same pair — second request should return 400 with `Already settled…` or a capped `maxAmount` of ~0.
2. Partial settle $30 then $30 on $50 debt — second should cap to $20.

## Limits

- Advisory lock scope is **per pair per currency per group** (not whole group).
- SQL balance must stay in sync with `lib/group-balances.ts` when logic changes — add tests in `lib/__tests__/financial-math.test.ts` and consider a parity integration test.
- After deploying code, run **`20260603`** in Supabase if you already applied `20260601`–`20260602`.
