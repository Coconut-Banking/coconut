# Email Receipt Matching — Itemized Transaction Data Plan

> **Revised** after engineering + security review. Key changes:
> - Fixed API endpoint references (`/api/plaid/transactions/route.ts`, not `/api/transactions/route.ts`)
> - Specified `TransactionDrawer` component for receipt display
> - Removed Gmail webhooks from Phase 3 (requires GCP Pub/Sub — too complex for v1)
> - Phase 5: keep `gmail_connections` table, add `email_connections` as new table (non-destructive)
> - Removed Yahoo Mail (API deprecated since 2019)
> - Added PII scrubbing before OpenAI calls (security requirement)
> - Added security hardening items

## Problem

Plaid provides Level 1 transaction data: merchant name, total amount, date, and category. But when a user spends $147.32 at Walmart, we have no idea what they bought — it could be groceries, electronics, or a mix. This matters for:

- **Accurate category breakdowns**: A Walmart trip might be 80% groceries, 15% household, 5% entertainment
- **Budget tracking**: Users want to know "how much did I spend on groceries?" not "how much did I spend at Walmart?"
- **Item-level insights**: "You've bought milk 4 times this month" or "Your detergent spend is up 30%"

**Solution**: Match email receipts (which contain itemized data) to bank transactions. Most major retailers send email receipts with line items. By connecting Gmail, scanning for receipts, parsing them with AI, and matching them to bank transactions, we can enrich Plaid data with item-level detail.

## What Already Exists

### Built and Shipped

| Component | File | Status |
|---|---|---|
| Gmail OAuth connect/disconnect | `app/api/gmail/{auth,callback,disconnect,status}/route.ts` | Complete |
| Gmail receipt scanning | `app/api/gmail/scan/route.ts` + `lib/receipt-parser.ts` | Complete: fetches emails, uses GPT-4o-mini to extract merchant/amount/date/line_items |
| Receipt matching engine | `lib/receipt-matcher.ts` | Complete: keyword + amount + date matching with scoring |
| Email receipts page | `app/app/email-receipts/page.tsx` | Complete: lists receipts, shows line items, "Matched" badge |
| Email receipts API | `app/api/email-receipts/route.ts` | Complete: CRUD for receipts |
| Gmail hook | `hooks/useGmail.ts` | Complete |
| Config/tuning | `lib/config.ts` | Complete: `GMAIL.*` and `RECEIPT_MATCH.*` constants |
| Amazon dedup fix | Recent PR | Fixed: only count "Ordered:" subjects, skip Shipped/Delivered |

### What's Missing

The pipeline exists end-to-end, but it's disconnected from the core transaction experience. Receipts live on their own page. The key missing pieces:

1. **Transaction page integration** — When viewing a transaction, show its matched receipt's line items inline
2. **Category re-splitting** — Use line items to split a single transaction into sub-categories
3. **Automatic scanning** — Currently manual "Scan" button; should run automatically
4. **Match review UI** — No way to manually match/unmatch receipts to transactions
5. **Multi-provider support** — Only Gmail; need Outlook
6. **Item-level analytics** — No insights derived from line items yet

---

## Architecture

```
Gmail / Outlook
        |
        v
  Email Fetch (OAuth)
        |
        v
  PII Scrubber (strip names, addresses, card numbers)
        |
        v
  Receipt Parser (GPT-4o-mini)
  - Extracts: merchant, amount, date, currency
  - Extracts: line_items[{name, quantity, price, category}]
        |
        v
  email_receipts table
        |
        v
  Receipt Matcher (receipt-matcher.ts)
  - Multi-signal scoring (merchant + amount + date + card)
  - Auto-match >= 70pts, Suggest >= 40pts
        |
        v
  email_receipts.transaction_id -> transactions.id
        |
        v
  TransactionDrawer (transaction detail view)
  - Shows line items from matched receipt
  - Category breakdown per item
        |
        v
  Analytics Engine
  - Item-level spending trends
  - Sub-category breakdowns for big-box stores
```

---

## Implementation Phases

### Phase 0: Security Hardening (1 day)

Before enhancing the receipt system, fix existing security gaps.

#### 0A. PII Scrubbing Before OpenAI

**File**: `lib/receipt-parser.ts`

Email bodies (up to 12K chars) are sent to OpenAI without redaction. They often contain names, addresses, phone numbers, credit card last-4 digits.

Add a pre-processing step:
```typescript
function scrubPII(emailBody: string): string {
  return emailBody
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')       // phone numbers
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]') // full card numbers
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')                  // SSNs
    // Keep last-4 of cards (useful for matching), redact full numbers
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]'); // email addresses
}
```

#### 0B. User Consent Disclosure

Add a notice in the Gmail connect flow: "Email receipts are processed by AI (OpenAI) to extract purchase details. Only receipt-related emails are read."

#### 0C. Encrypt Gmail Tokens

Same as PayPal — encrypt `gmail_connections.access_token` and `refresh_token` at rest.

#### 0D. Add Timeout to Gmail API Calls

**File**: `lib/receipt-parser.ts`

Gmail API calls should have explicit timeouts to prevent hanging requests.

---

### Phase 1: Transaction-Receipt Integration (3-4 days)

**Goal**: When a user views a transaction that has a matched receipt, show the itemized breakdown inline.

#### 1A. Enrich Transaction API Response

**File**: `app/api/plaid/transactions/route.ts` (this is where transactions are fetched, NOT `/api/transactions/route.ts` which doesn't exist)

In the GET handler, after fetching transactions, left-join `email_receipts` where `transaction_id` matches. Include receipt data in the response:

```typescript
// For list view: only include { hasReceipt: boolean } flag (lightweight)
// For detail view (or separate endpoint): include full receipt with line_items
{
  id: "txn_123",
  merchant_name: "Walmart",
  amount: -147.32,
  date: "2026-03-15",
  has_receipt: true,  // list view flag
  receipt: {          // detail view only
    id: "receipt_456",
    line_items: [
      { name: "Organic Milk", quantity: 2, price: 6.99, category: "GROCERIES" },
      { name: "HDMI Cable", quantity: 1, price: 12.99, category: "ELECTRONICS" },
    ],
    subtotal: 132.40,
    tax: 14.92,
    total: 147.32,
  }
}
```

**Performance note**: Don't fetch full `line_items` JSONB for every transaction in list view. Only fetch the receipt flag (a simple `exists` subquery or left join checking `transaction_id IS NOT NULL`). Load full receipt data on demand when the user opens the TransactionDrawer.

#### 1B. Transaction Detail UI

**File**: `app/app/transactions/page.tsx` — specifically the `TransactionDrawer` component (lines ~79-194)

When the drawer opens for a transaction with `has_receipt: true`, fetch the full receipt:

```
GET /api/email-receipts?transactionId=txn_123
```

Display in the drawer:

```
Walmart                           -$147.32
March 15, 2026                    Groceries

--- Receipt Items ---
Organic Milk (x2)                   $13.98  [Groceries]
HDMI Cable                          $12.99  [Electronics]
Tide Pods                           $14.97  [Household]
Bananas                              $1.29  [Groceries]
... 8 more items

Subtotal                           $132.40
Tax                                 $14.92
Total                              $147.32

[View in Gmail ->]
```

- Each line item shows its AI-assigned category
- User can tap a category to change it (override — saved to `email_receipts.line_items` JSONB)
- "View in Gmail" deep link using `gmail_message_id`

#### 1C. Receipt Match Badge

In the transaction list view, show a small receipt icon (e.g., `<Receipt className="w-3.5 h-3.5" />`) next to the merchant name for transactions where `has_receipt: true`.

On hover: tooltip "Itemized receipt available". On click: opens the TransactionDrawer.

---

### Phase 2: AI-Powered Item Categorization (3-4 days)

**Goal**: Each line item gets a category, enabling sub-transaction category splitting.

#### 2A. Enhance Receipt Parser Prompt

**File**: `lib/receipt-parser.ts` (lines ~135-176)

Current prompt extracts `line_items: [{ name, quantity, price }]`. Enhance to include category per item using Plaid's taxonomy:

```json
{
  "line_items": [
    {
      "name": "Organic Milk 1 Gallon",
      "quantity": 2,
      "unit_price": 6.99,
      "total": 13.98,
      "category": "FOOD_AND_DRINK"
    }
  ],
  "subtotal": 132.40,
  "tax": 14.92,
  "tip": 0,
  "payment_method": "Visa ending 4242",
  "order_number": "112-3456789-0123456"
}
```

**Token cost**: ~$0.03/user/month (negligible). GPT-4o-mini handles taxonomy classification well.

**Migration for existing receipts**: New receipts get categories automatically. Existing receipts WITHOUT categories are NOT re-parsed (too expensive). They'll show items without category badges in the UI — acceptable degradation.

#### 2B. Add Receipt Metadata Columns

```sql
alter table email_receipts add column if not exists subtotal numeric(14,2);
alter table email_receipts add column if not exists tax numeric(14,2);
alter table email_receipts add column if not exists tip numeric(14,2);
alter table email_receipts add column if not exists order_number text;
alter table email_receipts add column if not exists payment_method text;
alter table email_receipts add column if not exists match_confidence numeric(4,3);
alter table email_receipts add column if not exists match_source text default 'auto';
alter table email_receipts add column if not exists matched_at timestamptz;
```

#### 2C. Category Split Table

New table for item-level category breakdowns per transaction:

```sql
create table if not exists transaction_category_splits (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references transactions(id) on delete cascade,
  category        text not null,
  amount          numeric(14,2) not null,
  source          text not null default 'receipt',
  created_at      timestamptz default now(),
  unique(transaction_id, category)
);
create index tcs_txn_idx on transaction_category_splits(transaction_id);
alter table transaction_category_splits enable row level security;
```

**Note on unique constraint**: `unique(transaction_id, category)` is intentional aggregation. Two grocery items at Walmart = one row with summed amount. Fine-grained item data is preserved in `email_receipts.line_items` JSONB; this table is for analytics queries only.

When a receipt is matched to a transaction, auto-populate splits:
- Group line items by `category`
- Sum `total` per category
- Upsert into `transaction_category_splits`

#### 2D. Category Analytics Override

When computing category totals, check if a transaction has splits. Affected files:

- `lib/insights-engine.ts` — `detectSpendingTrends()` (lines 126-186): when iterating transactions, check for splits and distribute amount across categories
- `lib/cached-queries.ts` — if category aggregation happens here
- `app/app/dashboard/page.tsx` — client-side category chart computation
- Any spending breakdown or budget calculation

Logic:
- **No splits**: Use `primary_category` as today (whole amount → one category)
- **Has splits**: Distribute amount across categories per split ratios

---

### Phase 3: Automatic Receipt Scanning (2-3 days)

**Goal**: Receipts are scanned automatically, not just when the user clicks "Scan".

#### 3A. Post-Sync Receipt Scan

**File**: `lib/transaction-sync.ts` — at the end of the exported `syncTransactionsForUser()` function

After Plaid transaction sync completes, trigger a receipt scan for the new date range. Must be non-blocking and properly async:

```typescript
// At end of syncTransactionsForUser():
if (gmailConnected) {
  // Fire-and-forget — don't block the sync response
  scanForMatchingReceipts(clerkUserId, {
    daysBack: 7,
    transactionIds: newTransactionIds // only match against new transactions
  }).catch((err) => console.error('[receipt-scan] post-sync scan failed:', err));
}
```

**Important**: This runs AFTER the transaction commit, not during. The new transactions must be persisted before the receipt matcher can find them.

#### 3B. Background Scan on Dashboard Load

**File**: `app/app/dashboard/page.tsx`

On dashboard load, if Gmail is connected and last scan > 24 hours ago, trigger a background scan. This is **non-blocking** — the dashboard renders immediately with existing data.

```typescript
// In dashboard useEffect (non-blocking):
if (gmail.connected && lastGmailScan && isOlderThan(lastGmailScan, 24 * 60 * 60 * 1000)) {
  fetch("/api/gmail/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ daysBack: 7, detailed: true }),
  }).catch(() => {}); // Fire and forget
}
```

#### 3C. Gmail Webhooks — DEFERRED

> Gmail push notifications via `gmail.users.watch()` require Google Cloud Pub/Sub setup, webhook verification, and notification batching handling. This is too complex for v1. **Deferred to a future phase** if polling proves insufficient.

---

### Phase 4: Match Review & Manual Matching (2-3 days)

**Goal**: Users can review, confirm, correct, or create receipt-to-transaction matches.

#### 4A. Match Status API

```
GET /api/email-receipts/unmatched
Response: {
  receipts: [
    {
      id: "receipt_789",
      merchant: "Target",
      amount: 52.41,
      date: "2026-03-10",
      match_status: "pending",  // 'pending' | 'matched' | 'no_match'
      suggestedMatch: {
        transactionId: "txn_456",
        merchant: "TARGET",
        amount: -52.41,
        date: "2026-03-10",
        confidence: 0.92
      }
    }
  ]
}
```

Suggested matches computed by running `receipt-matcher.ts` in suggestion-only mode (don't auto-update DB).

#### 4B. Manual Match/Unmatch API

```
POST /api/email-receipts/:id/match
Body: { transactionId: "txn_456" }
→ Sets transaction_id, match_source='manual', matched_at=now()

DELETE /api/email-receipts/:id/match
→ Clears transaction_id, sets match_source=null

PATCH /api/email-receipts/:id/status
Body: { match_status: "no_match" }
→ Marks as "no corresponding bank transaction" (cash payment, etc.)
```

#### 4C. Review UI

Add a "Review Matches" tab on the Email Receipts page (`app/app/email-receipts/page.tsx`):
- **Unmatched receipts**: List with suggested bank transaction matches
- **One-click confirm**: Accept the suggested match
- **Manual search**: Type merchant/amount to find the right bank transaction
- **"No match"**: Mark receipt as cash payment or no bank record
- **Batch actions**: "Match all high-confidence suggestions" button

---

### Phase 5: Outlook Email Support (5-7 days)

**Goal**: Support Outlook in addition to Gmail.

> Yahoo Mail removed — Yahoo's mail API was deprecated in 2019.

#### 5A. Email Provider Abstraction

Create `lib/email-providers/` with a common interface:

```typescript
interface EmailProvider {
  name: string;
  getAuthUrl(userId: string, nonce: string): string;
  exchangeCode(code: string): Promise<EmailTokens>;
  refreshToken(refreshToken: string): Promise<EmailTokens>;
  fetchEmails(accessToken: string, query: string, maxResults: number): Promise<RawEmail[]>;
}
```

Implementations:
- `lib/email-providers/gmail.ts` — extract existing logic from `lib/google-auth.ts`
- `lib/email-providers/outlook.ts` — Microsoft Graph API with `Mail.Read` scope

#### 5B. Outlook Integration

Microsoft Graph API:
- OAuth: Azure AD app registration, `Mail.Read` scope
- Fetch: `GET /me/messages?$filter=...` (OData filter syntax, different from Gmail query syntax)
- Parse: Same GPT-4o-mini pipeline, same PII scrubbing

#### 5C. DB Schema — Non-Destructive Migration

**DO NOT rename `gmail_connections`**. Create a new table alongside it:

```sql
create table if not exists email_connections (
  id              uuid primary key default gen_random_uuid(),
  clerk_user_id   text not null,
  provider        text not null, -- 'gmail', 'outlook'
  access_token    text not null, -- encrypted
  refresh_token   text,          -- encrypted
  token_expiry    timestamptz,
  email           text,
  last_scan_at    timestamptz,
  created_at      timestamptz default now(),
  unique(clerk_user_id, provider)
);
alter table email_connections enable row level security;
create policy email_conn_rls on email_connections
  using (clerk_user_id = current_setting('app.user_id'));
```

Migration strategy:
1. Create `email_connections` table
2. Backfill: copy existing `gmail_connections` rows into `email_connections` with `provider = 'gmail'`
3. Update code to read from `email_connections` (with fallback to `gmail_connections` for transition)
4. After verified stable: drop `gmail_connections` in a later migration

---

### Phase 6: Item-Level Analytics (3-4 days)

**Goal**: Surface insights from line-item data that aren't possible with transaction-level data alone.

#### 6A. Sub-Category Dashboard Widget

**File**: `app/app/dashboard/page.tsx` — add below the spending category chart

For merchants with receipt data (Walmart/Target/Costco/Amazon), show category breakdown:

```
Walmart (6 trips this month)         Total: $847.23
  Groceries        ████████████████   $612.40  (72%)
  Household        ████               $134.83  (16%)
  Electronics      ██                  $67.00   (8%)
  Other            █                   $33.00   (4%)
```

Data source: `transaction_category_splits` table, aggregated per merchant per month.

#### 6B. Item-Level Insights

**File**: `lib/insights-engine.ts` — add new `detectItemTrends()` function

```typescript
async function detectItemTrends(userId: string, db: ...): Promise<Insight[]> {
  // Query: join email_receipts + transactions, extract line_items JSONB
  // Group by item name (normalized), sum amounts, compare to last month
  //
  // Example insights:
  // "You've spent $45 on coffee pods this month across 3 Amazon orders"
  // "Your grocery spend at Walmart is 40% higher than last month"
  // "You bought the same HDMI cable twice in 2 weeks"
}
```

SQL sketch:
```sql
select r.merchant, item->>'name' as item_name,
       sum((item->>'total')::numeric) as total_spent,
       count(*) as purchase_count
from email_receipts r, jsonb_array_elements(r.line_items) as item
join transactions t on r.transaction_id = t.id
where t.clerk_user_id = $1
  and t.date >= date_trunc('month', now())
group by r.merchant, item->>'name'
having sum((item->>'total')::numeric) > 20
order by total_spent desc
limit 10;
```

#### 6C. Receipt-Enhanced Search — DEFERRED

> Searching within JSONB `line_items` arrays requires careful indexing and benchmarking. A GIN index (`jsonb_path_ops`) helps for exact key lookups but NOT for full-text search across item names. This needs prototyping before committing.
>
> **Deferred** until we can benchmark performance on real data. If needed, consider materializing item names into a separate `receipt_line_items` table with a proper tsvector index.

---

## Matching Algorithm Improvements

### Current Algorithm (`lib/receipt-matcher.ts`)

1. Extract merchant keywords from receipt
2. Search transactions by keyword + date window + amount tolerance
3. Score by amount difference + date difference
4. Fallback: amount + date only (tight $1 tolerance)

### Proposed: Multi-Signal Scoring

Replace binary match with composite score (ship WITHOUT card matching in v1):

```typescript
interface MatchScore {
  merchantScore: number;  // 0-40 pts: keyword overlap
  amountScore: number;    // 0-30 pts: amount proximity
  dateScore: number;      // 0-20 pts: date proximity
  total: number;          // sum (max 90 without card matching)
}
```

- **Merchant**: Full name match = 40, partial keyword = 20, no match = 0
- **Amount**: Exact = 30, within $1 = 25, within 5% = 15, within 10% = 5
- **Date**: Same day = 20, +/- 1 day = 15, +/- 3 days = 5

Auto-match threshold: >= 70 points
Suggest threshold: >= 40 points
Below 40: no match

**Card matching** (Visa ending 4242 → Plaid account) deferred to Phase 5+ after parser outputs `payment_method` reliably.

### Batch Matching Optimization

Current implementation: N DB queries for N receipts (slow).
Proposed: Fetch all unmatched receipts + all transactions in combined date range, score in memory, batch update.

### Order Number Dedup

Store `order_number` on `email_receipts`. Before matching, check if a receipt with the same order number is already matched → skip. Prevents duplicate matches from rescans.

---

## Privacy & Security

1. **PII scrubbing**: Strip phone numbers, full card numbers, SSNs, email addresses from email bodies BEFORE sending to OpenAI. Keep last-4 of cards (useful for matching).

2. **User consent**: Add disclosure during Gmail connect: "Email receipts are processed by AI to extract purchase details."

3. **Token encryption**: Encrypt Gmail/Outlook tokens at rest (same approach as PayPal tokens).

4. **Email scope**: We only read emails matching receipt-related queries (`GMAIL.RECEIPT_KEYWORDS`). We do NOT read all emails.

5. **Storage**: We store parsed receipt data but NOT raw email bodies. `gmail_message_id` stored for "View in Gmail" links.

6. **User control**: Users can disconnect Gmail, delete all receipts, or exclude specific merchants.

---

## Supported Merchants (Receipt Parsing)

| Merchant | Email Domain | Line Items |
|---|---|---|
| Amazon | amazon.com | Yes, detailed |
| Walmart | walmart.com | Yes |
| Target | target.com | Yes |
| Costco | costco.com | Yes |
| Uber/Uber Eats | uber.com | Yes (ride details / food items) |
| DoorDash | doordash.com | Yes (food items) |
| Instacart | instacart.com | Yes (groceries) |
| Apple | apple.com | Yes (app/service name) |
| Google Play | google.com | Yes (app name) |
| Best Buy | bestbuy.com | Yes |
| Chewy | chewy.com | Yes (pet supplies) |

---

## Priority Order

| Phase | Effort | Impact | Ship Order |
|-------|--------|--------|------------|
| 0: Security Hardening | 1 day | Critical | **First** |
| 1: Transaction-Receipt Integration | 3-4 days | **Highest** — makes existing data useful | Second |
| 2: AI Item Categorization | 3-4 days | High — enables sub-category analytics | Third |
| 3: Automatic Scanning | 2-3 days | High — removes manual step | Fourth |
| 4: Match Review UI | 2-3 days | Medium — improves accuracy | Fifth |
| 5: Outlook Email Support | 5-7 days | Medium — expands addressable users | Sixth |
| 6: Item-Level Analytics | 3-4 days | Medium — differentiation feature | Seventh |

**Total estimate: ~20-26 days**

---

## Success Metrics

- **Match rate**: % of email receipts successfully matched to bank transactions (target: >80%)
- **Coverage**: % of big-box store transactions with receipt data (target: >50% for Gmail users)
- **Category accuracy**: % of AI-assigned item categories confirmed by users (target: >90%)
- **User engagement**: % of users who connect Gmail after seeing the feature (target: >30% of active users)
