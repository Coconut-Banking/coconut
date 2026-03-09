# Subscriptions Feature — Staff Engineer Plan

## Executive summary

A **subscription** is a discretionary recurring charge for a service or product you can cancel (Netflix, Spotify, gym, iCloud, Adobe). **Rent, mortgage, utilities, and insurance are bills** — recurring but not subscriptions. Coconut should treat them differently and avoid inflating the subscriptions list with essential bills.

---

## 1. Definition: subscription vs recurring bill

| Type | Examples | User intent | Coconut action |
|------|----------|-------------|----------------|
| **Subscription** | Netflix, Spotify, gym, iCloud, Adobe, ChatGPT Plus | Find and cancel stuff you forgot | Track, alert on price changes, suggest cancels |
| **Recurring bill** | Rent, mortgage, utilities, insurance, loan payments | Plan cash flow, know when it's due | Track elsewhere (e.g. "Bills" / "Recurring") — not in subscriptions |

Professional apps (Rocket Money, Monarch, Copilot) follow this split: subscriptions = cancellable discretionary spend; bills = essential committed spend.

---

## 2. Current state (gaps)

| Component | Current behavior | Problem |
|-----------|------------------|---------|
| `subscription-detect.ts` | Finds any recurring pattern (amount + timing), no exclusions | Rent, utilities, mortgage get detected as "subscriptions" |
| "Mark as subscription" (transactions) | Adds any transaction to subscriptions | User can add rent as subscription — pollutes list |
| Plaid integration | No recurring API used; `isRecurring` hardcoded `false` | We're doing our own recurrence logic |
| Categories | Uses `primary_category` but doesn't filter by it during detection | No bill vs subscription classification |

---

## 3. Design decisions

### 3.1 Exclusion list (do NOT auto-detect as subscription)

**Plaid categories to exclude:**
- `RENT_AND_UTILITIES`, `LOAN_PAYMENTS`, `MORTGAGE_PAYMENTS`, `INSURANCE_PREMIUMS`
- `BANK_FEES`, `INTEREST`
- `INVESTMENT`, `TRANSFER` (outflows that are not subscriptions)

**Merchant/name patterns to exclude (case-insensitive):**
- Rent: `rent`, `apartment`, `landlord`, `property management`
- Mortgage: `mortgage`, `home loan`, `escrow`
- Utilities: `electric`, `gas`, `water`, `sewer`, `trash`, `utility`, `power`, `xcel`, `pge`, `comed`, `duke energy`
- Insurance: `insurance`, `geico`, `state farm`, `allstate`, `premium`
- HOA: `hoa`, `homeowners`
- Loan/credit: `payment`, `loan`, `autopay` (when combined with bank name)

These should be configurable (e.g. in `lib/subscription-config.ts`) so we can tune without code deploy.

### 3.2 Positive signals (likely subscription)

**Plaid categories that are often subscriptions:**
- `SUBSCRIPTIONS` (obvious)
- `ENTERTAINMENT` (streaming) — but not all entertainment is sub
- `FITNESS` (gym memberships)
- `GENERAL_SERVICES` (SaaS, software)
- `PERSONAL_CARE` (subscription boxes)

**Merchant/name patterns (allowlist for confidence):**
- Known subscription merchants: `netflix`, `spotify`, `hulu`, `disney`, `amazon prime`, `apple`, `icloud`, `adobe`, `microsoft`, `dropbox`, `notion`, `chatgpt`, `openai`, `gym`, `planet fitness`, `la fitness`, `youtube premium`, `hbo`, `max`, `peacock`, `paramount`, `crunchyroll`, `audible`, `kindle`, `amazon music`, etc.

We can maintain a curated list and/or use Plaid `personal_finance_category` as primary signal.

### 3.3 Classification strategy

1. **Auto-detect path:**  
   Pattern-based (existing logic) → For each candidate: **apply exclusion list first**. If category or merchant matches bill pattern → skip (don’t save as subscription).  
   Optionally: only auto-add if category is in positive-signal set. Otherwise, surface as "Possible subscription" for user review.

2. **Manual "Mark as subscription" path:**  
   - If transaction category/merchant is in exclusion list → show confirmation: *"This looks like a bill (rent/utility), not a subscription. Add to subscriptions anyway?"*  
   - If in positive-signal set → add directly.  
   - Store `source: 'user_confirmed'` so we know the user explicitly added it.

3. **Plaid Recurring API (future):**  
   Plaid’s `/transactions/recurring/get` returns outflow streams. We could use it as input, then filter streams by category/merchant with the same exclusion logic. Not required for v1.

---

## 4. Data model changes

### 4.1 `subscriptions` table (existing, extend if needed)

Ensure we have:
- `source`: `'auto_detected'` | `'user_confirmed'` — how it was added
- `primary_category` — already present
- Optional: `is_bill` — if user added a bill anyway, we could tag it. Low priority.

### 4.2 Migration

If `source` doesn’t exist, add:

```sql
alter table subscriptions add column if not exists source text default 'auto_detected';
```

---

## 5. Implementation plan

### Phase 1: Accurate detection (no false positives from bills)

| Task | File(s) | Description |
|------|---------|-------------|
| 1.1 Exclusion config | `lib/subscription-config.ts` | Define `BILL_CATEGORIES`, `BILL_MERCHANT_PATTERNS`, `SUBSCRIPTION_CATEGORIES` |
| 1.2 Wire exclusions into detection | `lib/subscription-detect.ts` | Before adding a candidate, check category and normalized merchant against exclusions; skip if match |
| 1.3 Optional: confidence scoring | `lib/subscription-detect.ts` | Score 0–1; only auto-add if score > threshold. Low-confidence items could go to "Review" UI later |

### Phase 2: Smart "Mark as subscription"

| Task | File(s) | Description |
|------|---------|-------------|
| 2.1 API: classify before add | `app/api/subscriptions/route.ts` | When `transactionId` provided, lookup tx category/merchant; if matches bill pattern, return `{ suggestedBill: true, merchant, category }` so client can show confirmation |
| 2.2 Client: confirmation modal | `app/app/transactions/page.tsx` | If API says `suggestedBill`, show: "This looks like a bill. Add anyway?" with [Cancel] [Add to subscriptions] |
| 2.3 Store source | `app/api/subscriptions/route.ts` | When adding from transaction, set `source: 'user_confirmed'` |

### Phase 3: Alerts and UX (price increase, duplicate)

| Task | File(s) | Description |
|------|---------|-------------|
| 3.1 Price increase detection | `lib/subscription-detect.ts` or new `lib/subscription-alerts.ts` | When saving/linking transactions, compare latest amount to running average; if increase >15%, set `alert: 'price_increased'` or similar |
| 3.2 Duplicate detection | Same | Same merchant name with multiple subscriptions (e.g. Adobe Creative Cloud + Adobe Stock) or same category — flag as possible duplicate |
| 3.3 Alerts in UI | `app/app/subscriptions/page.tsx` | Show alerts (price increase, duplicate) with dismiss. Reuse existing mock alert structure for real data |

### Phase 4: Plaid Recurring API (optional)

| Task | File(s) | Description |
|------|---------|-------------|
| 4.1 Plaid client | `lib/plaid-client.ts` | Add `transactionsRecurringGet` if available in plan |
| 4.2 Use streams as candidates | `lib/subscription-detect.ts` | Fetch recurring streams; for each outflow stream, apply exclusion list; merge with our pattern-based detection (dedupe by merchant) |

---

## 6. Edge cases and safeguards

| Edge case | Handling |
|-----------|----------|
| Rent paid to "ABC Property Mgmt" | Excluded via `RENT_AND_UTILITIES` or merchant pattern `property` |
| Netflix billed as "NETFLIX.COM" | Positive signal; no exclusion |
| Gym with generic name "Fitness Center" | Category `FITNESS` or recurrence pattern + not in exclusion → allow |
| User adds rent anyway | Confirmation modal; if they confirm, add with `source: 'user_confirmed'`. We don’t block. |
| Electric company with "SUBSCRIPTION" in Plaid category | Rare; exclusion via merchant pattern (`electric`, `utility`) takes precedence |
| New subscription, only 1 charge so far | Pattern-based needs ≥2. "Mark as subscription" allows 1. |

---

## 7. Terminology and copy

- **Subscriptions page title:** "Subscriptions" (not "Recurring charges")
- **Empty state:** "No subscriptions detected. We look for recurring charges from streaming, software, gyms, and similar services — not rent or utilities."
- **Detect button:** "Detect subscriptions" (clearer than "Detect recurring charges")
- **Dismiss:** Keep "Dismiss" — means "don’t show in my subscriptions" (could be bill or duplicate)

---

## 8. Testing checklist

- [ ] Recurring rent (e.g. "ABC RENT") → NOT in subscriptions
- [ ] Recurring Netflix → IN subscriptions
- [ ] "Mark as subscription" on rent → Confirmation shown; if confirmed, added
- [ ] "Mark as subscription" on Netflix → Added directly
- [ ] Duplicate (two Adobe products) → Alert shown
- [ ] Price increase (Netflix $10→$15) → Alert shown
- [ ] Gym, iCloud, Spotify → All in subscriptions
- [ ] Electric bill, mortgage → NOT in subscriptions

---

## 9. Files to create/modify

| Action | Path |
|--------|------|
| Create | `lib/subscription-config.ts` — exclusion + allowlist config |
| Modify | `lib/subscription-detect.ts` — apply exclusions, optional confidence |
| Modify | `app/api/subscriptions/route.ts` — transaction classification, source |
| Modify | `app/app/transactions/page.tsx` — confirmation when marking bill as sub |
| Modify | `app/app/subscriptions/page.tsx` — copy, wire real alerts |
| Create | `lib/subscription-alerts.ts` — price increase, duplicate logic (optional) |
| Add migration | `docs/supabase-migration-subscriptions-source.sql` — add `source` if needed |

---

## 10. Rollout

1. Deploy config + detection changes. Existing subscriptions stay; new detections will be filtered.
2. No data migration of existing rows required for v1.
3. Optionally: background job to flag existing subscriptions that look like bills (e.g. category = RENT_AND_UTILITIES) for user review. Low priority.
