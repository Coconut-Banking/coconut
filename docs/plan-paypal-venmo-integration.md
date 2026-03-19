# PayPal & Venmo Integration Plan

> **Revised** after engineering + security review. Key changes:
> - All P2P data writes to the main `transactions` table (not `p2p_transactions`)
> - Phase 2 pivoted to CSV-only (Venmo has no public OAuth API)
> - Security hardening added as Phase 0
> - Phase 3 (manual linking) replaced with dedup/merge strategy
> - Effort estimates revised upward

## Problem

Users have transactions on PayPal and Venmo that don't appear in their Plaid-connected bank data with useful context. When a user sends $50 on Venmo, their bank shows "VENMO PAYMENT" with no info about who they paid or why. We need to:

1. Pull in the **actual P2P transaction details** (counterparty name, note, date) from PayPal/Venmo
2. **Enrich or deduplicate** bank transactions with P2P data so the user sees the full picture
3. Show PayPal/Venmo **balances** alongside bank accounts
4. Enable **deep-link payments** from shared expenses (settle up via Venmo/PayPal)

## Core Architecture Decision: Use `transactions` Table

**All P2P transaction data goes into the main `transactions` table**, not a separate `p2p_transactions` table. This means:

- All existing features (search, insights, category breakdowns, charts) automatically work with P2P data
- No custom joins or special-casing needed in the UI
- The `source` column distinguishes origin: `plaid`, `paypal`, `venmo`, `csv_import`
- **Deduplication replaces linking**: When both Plaid and PayPal report the same transaction, we merge them (keeping richer P2P data) instead of maintaining two records with a foreign key

### Dedup Strategy

When PayPal sync imports a transaction, check for an existing Plaid transaction:
1. Match by: amount (within $0.02) + date (same day or +/- 1 day) + merchant contains "paypal" or "venmo"
2. If match found: **enrich** the Plaid row with P2P metadata (counterparty name, note, platform) instead of inserting a duplicate
3. If no match: insert as new row with `source = 'paypal'` (the bank transfer may not have posted yet)
4. On next Plaid sync: if a new Plaid transaction matches an existing `source = 'paypal'` row, merge (keep P2P metadata, update with Plaid's `plaid_transaction_id`)

This eliminates the entire `p2p_transactions` table, `auto-link.ts`, and the manual linking UI.

---

## What Already Exists

### Built (unshipped, on current branch)

| Component | File | Status | Needs Changes |
|---|---|---|---|
| PayPal OAuth flow | `lib/paypal-auth.ts` | Complete | Yes — add CSRF nonce, token encryption |
| PayPal transaction sync | `lib/paypal-sync.ts` | Complete | Yes — write to `transactions` table instead of `p2p_transactions` |
| PayPal API routes | `app/api/paypal/{auth,callback,sync,disconnect}/route.ts` | Complete | Yes — callback needs session validation, sync needs rate limiting |
| PayPal React hook | `hooks/usePayPal.ts` | Partial | Yes — replace manual_accounts proxy with proper status endpoint |
| CSV import (Venmo/CashApp/PayPal) | `lib/csv-import/parsers.ts` | Complete | Yes — write to `transactions` table |
| CSV import API route | `app/api/csv-import/route.ts` | Complete | Yes — update upsert target |
| CSV import modal UI | `components/csv-import-modal.tsx` | Exists | Minor |
| DB schema | `supabase/migrations/20250316_add_p2p_tables.sql` | Complete | Yes — `p2p_transactions` table no longer needed; add `source` column to `transactions` |

---

## Implementation Phases

### Phase 0: Security Hardening (1-2 days) — MUST DO FIRST

Before shipping any PayPal integration to production, fix these critical security issues.

#### 0A. Fix PayPal OAuth Callback — Session Validation

**File**: `app/api/paypal/callback/route.ts`

The callback currently trusts the `state` query param (which is the `clerk_user_id`) without verifying it matches the authenticated session. An attacker can modify `state` to link their PayPal to a victim's account.

```typescript
// CURRENT (vulnerable):
const state = searchParams.get("state"); // clerk_user_id — UNVERIFIED
await savePayPalTokens(state, tokens, email, payerId);

// FIXED:
const { userId } = await auth();
if (!userId || userId !== state) {
  return NextResponse.redirect(new URL("/app/settings?paypal=unauthorized", request.url));
}
await savePayPalTokens(userId, tokens, email, payerId);
```

#### 0B. Add CSRF Nonce to OAuth State

**File**: `lib/paypal-auth.ts`

The state parameter should include a cryptographic nonce, not just the user ID. Without it, an attacker who knows a victim's Clerk ID can forge OAuth flows.

```typescript
// Generate: state = `${userId}:${nonce}`
// Store nonce in DB or KV with 10-minute expiry
// On callback: split state, verify nonce exists and matches, delete nonce
```

#### 0C. Encrypt Tokens at Rest

**Files**: `lib/paypal-auth.ts`, migration

PayPal access/refresh tokens are stored plaintext. Use Supabase Vault or app-level AES-256-GCM encryption.

#### 0D. Add Rate Limiting to Sync Endpoint

**File**: `app/api/paypal/sync/route.ts`

```typescript
const rl = rateLimit(`paypal-sync:${effectiveUserId}`, 5, 60_000);
if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
```

#### 0E. Hardblock Demo Mode in Production

**File**: `lib/demo.ts`

```typescript
if (process.env.NODE_ENV === "production") return false;
```

---

### Phase 1: Ship PayPal Integration (4-5 days)

**Goal**: Users can connect PayPal, sync transactions into the main transactions table, see enriched data.

#### 1A. Schema Changes

Add `source` and P2P metadata columns to `transactions`:

```sql
alter table transactions add column if not exists source text default 'plaid';
alter table transactions add column if not exists p2p_counterparty text;
alter table transactions add column if not exists p2p_note text;
alter table transactions add column if not exists p2p_platform text;
alter table transactions add column if not exists external_id text;
create index if not exists tx_source_idx on transactions(clerk_user_id, source);
create unique index if not exists tx_external_id_idx on transactions(clerk_user_id, source, external_id) where external_id is not null;
```

#### 1B. Rewrite PayPal Sync to Target `transactions`

**File**: `lib/paypal-sync.ts`

Current: upserts into `p2p_transactions` table.
New: upserts into `transactions` table with dedup logic.

For each PayPal transaction:
1. Check if a matching Plaid transaction exists (amount + date + merchant contains "paypal")
2. If yes: UPDATE the existing row to add `p2p_counterparty`, `p2p_note`, `p2p_platform = 'paypal'`
3. If no: INSERT new row with `source = 'paypal'`, counterparty/note filled in, no `plaid_transaction_id`

#### 1C. PayPal Status Endpoint

**Create**: `app/api/paypal/status/route.ts`

```
GET /api/paypal/status
Response: { connected: boolean, email: string | null, lastSyncAt: string | null }
```

Reuse `getPayPalStatus()` from `lib/paypal-auth.ts` (already exists, just needs an API route).

Update `hooks/usePayPal.ts` to call this instead of the `manual_accounts` proxy.

#### 1D. Settings Page Integration

**File**: `app/app/settings/page.tsx`

Add a "Digital Wallets" section (new tab alongside Banks, Email, etc.):
- "Connect PayPal" button (triggers OAuth)
- Connected state: shows PayPal email, last sync time, "Sync Now" button, "Disconnect" button
- Handle `?paypal=connected` and `?paypal=error` query params from OAuth callback
- "Import CSV" button for Venmo/CashApp/PayPal statement imports

#### 1E. P2P Transaction Display

**File**: `app/app/transactions/page.tsx` (TransactionDrawer component)

When a transaction has `p2p_counterparty` set:
- Show badge in list view: "PayPal: John Smith"
- In drawer detail: show counterparty name, note, platform icon
- No separate P2P page needed — it's all in the main transactions table

#### 1F. Auto-Sync on Dashboard Load

**File**: `app/app/dashboard/page.tsx`

For returning users with PayPal connected, sync in background if last sync > 6 hours ago. Non-blocking fire-and-forget.

Check `lastSyncAt` via the status endpoint first to avoid unnecessary syncs.

---

### Phase 2: Venmo & Cash App via CSV (1-2 days)

**Goal**: Users can import Venmo/Cash App transaction history via CSV. CSV import already works — this phase surfaces it properly.

> **Why no Venmo OAuth**: Venmo does not have a public OAuth API for third-party apps. The API is private and requires partnership agreements. CSV import is the primary (and currently only) path.

#### 2A. CSV Import UX Improvements

**File**: `components/csv-import-modal.tsx`, Settings page

- Surface CSV import prominently in the "Digital Wallets" settings section
- Platform-specific instructions: "Download your Venmo statement from Settings > Statements" with screenshots
- After import, show results: "Imported 47 Venmo transactions, 31 matched to bank records"

#### 2B. Rewrite CSV Import to Target `transactions`

**File**: `app/api/csv-import/route.ts`, `lib/csv-import/parsers.ts`

Same dedup strategy as PayPal:
1. Parse CSV into rows
2. For each row, check if matching bank transaction exists
3. If yes: enrich with P2P metadata
4. If no: insert with `source = 'venmo'` or `'cashapp'`

#### 2C. File Validation Improvements (Security)

Add missing validation to CSV import:
- Check `file.name.endsWith('.csv')` and validate MIME type
- Sanitize filename before any logging
- Improve formula injection prevention (current regex is incomplete)

---

### Phase 3: Deep-Link Payments (2-3 days)

**Goal**: From shared expenses, users can tap "Pay via Venmo/PayPal" to open the payment app.

#### 3A. P2P Handles on Group Members

Already in schema: `group_members.venmo_username`, `cashapp_cashtag`, `paypal_username`.

Add UI in group member edit flow to set these handles.

#### 3B. Deep-Link Generation

**File**: `lib/p2p-deeplinks.ts` (already started)

```typescript
// Venmo: venmo://paycharge?txn=pay&recipients=USERNAME&amount=AMOUNT&note=NOTE
// PayPal: https://paypal.me/USERNAME/AMOUNT
// Cash App: https://cash.app/$CASHTAG/AMOUNT
```

#### 3C. Settlement UI

On the "Shared Expenses" page, when a user owes money:
- Show "Pay" button next to each debt
- Bottom sheet with platform options (Venmo, PayPal, Cash App) based on payee's registered handles
- Opens deep link in payment app
- User manually confirms payment on return (no callback from deep links)

---

### Phase 4: Unified Balance View (1 day)

**Goal**: Dashboard shows all account balances including P2P wallets.

#### 4A. Balance Aggregation

`manual_accounts` table already stores PayPal balance (synced in `paypal-sync.ts`). Extend:
- Cash App / Venmo: manual entry only (no API)
- Add simple "Edit Balance" button on Digital Wallets section

#### 4B. Dashboard Integration

**File**: `app/app/dashboard/page.tsx`

Show "Digital Wallets" section alongside Plaid account balances:
- PayPal: $X.XX (auto-synced)
- Venmo: $X.XX (manual)
- Cash App: $X.XX (manual)
- Include in total net worth calculation

---

## Database Changes

### Migration: Add P2P columns to `transactions`

```sql
-- Add source tracking and P2P metadata to main transactions table
alter table transactions add column if not exists source text default 'plaid';
alter table transactions add column if not exists p2p_counterparty text;
alter table transactions add column if not exists p2p_note text;
alter table transactions add column if not exists p2p_platform text; -- 'paypal', 'venmo', 'cashapp'
alter table transactions add column if not exists external_id text; -- PayPal/Venmo transaction ID

-- Index for dedup queries
create index if not exists tx_source_idx on transactions(clerk_user_id, source);
-- Unique constraint for P2P dedup (only where external_id is set)
create unique index if not exists tx_external_id_idx
  on transactions(clerk_user_id, source, external_id) where external_id is not null;
```

### Tables No Longer Needed

- `p2p_transactions` — replaced by `transactions` with `source` column
- `auto-link.ts` — replaced by dedup logic in sync

### Tables Still Needed

- `paypal_connections` — PayPal OAuth tokens (add encryption)
- `manual_accounts` — P2P wallet balances
- `p2p_annotations` — user-provided counterparty names for Plaid transactions (keep for manual annotation on generic "VENMO PAYMENT" entries before P2P data enriches them)
- `group_members` P2P handle columns — for deep-link payments

---

## Environment Variables

```env
# PayPal (already defined)
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_REDIRECT_URI=https://coconut.app/api/paypal/callback
PAYPAL_ENV=sandbox  # or "production"

# Token encryption (new)
TOKEN_ENCRYPTION_KEY=  # 256-bit key for encrypting OAuth tokens at rest
```

No Venmo env vars needed (CSV-only, no OAuth).

---

## Risk & Open Questions

1. **Dedup accuracy**: The merge strategy depends on matching PayPal/Venmo transactions to their bank counterparts. Edge cases:
   - Multiple PayPal payments on the same day for the same amount → ambiguous match
   - PayPal payments that show as "PAYPAL *MERCHANTNAME" on bank statement (not "PAYPAL PAYMENT")
   - Mitigation: Only auto-merge when exactly one candidate matches. Otherwise, insert as separate row and let user see both.

2. **Rate limits**: PayPal's Transaction Search API allows ~30 requests/min. First sync (2-year lookback) could take several minutes. Need progress indicator in UI.

3. **Venmo API future**: If Venmo opens a public API or we secure a partnership, we can add OAuth as Phase 2B. The `transactions` table architecture supports this — just add another `source` value.

4. **Backfill**: Existing users with Plaid "VENMO PAYMENT" transactions won't have P2P metadata until they connect PayPal/import CSV. Consider: after first import, run a one-time backfill matching historical P2P data to old bank transactions.

---

## Priority Order

| Phase | Effort | Impact | Ship Order |
|-------|--------|--------|------------|
| 0: Security Hardening | 1-2 days | Critical | **First** |
| 1: PayPal Integration | 4-5 days | High | Second |
| 4: Unified Balances | 1 day | Medium | Third (quick win) |
| 2: Venmo/CashApp CSV | 1-2 days | High | Fourth |
| 3: Deep-Link Payments | 2-3 days | Medium | Fifth |

**Total estimate: ~10-13 days** (down from original because Phase 3 manual linking is eliminated)
