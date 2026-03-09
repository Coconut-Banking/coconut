# Main Dashboard — Plan & Spec

## Current state

The dashboard already has:
- Monthly spend (from transactions)
- 6‑month spending trend graph
- Top categories (from transactions)
- Recent transactions list
- 4 stat cards: Monthly Spend ✓, Subscriptions (placeholder), Shared Expenses (placeholder), Net Cash Flow (placeholder)
- Smart Insights panel (demo only when linked)

**Gaps:** Subscriptions, Shared, and Net Cash Flow show "—" when linked. Insights are placeholder.

---

## Recommended direction: Real data + cash flow

Use only data we already have and focus on making the dashboard actionable.

### 1. Hero metric: This month vs last month

- **This month spend**: sum of |negative| transactions this month
- **Last month spend**: same for last month
- **% change**: e.g. "↓ 12% from last month" or "↑ 8%"
- Same card as now, but with real comparison when linked

### 2. Net cash flow

- **Income**: sum of positive transactions this month (paychecks, transfers in, refunds)
- **Expenses**: sum of negative transactions this month
- **Cash flow**: income − |expenses|
- Show: "+$453" (green) or "−$200" (red) with "vs last month" if useful

### 3. Subscriptions (wire existing)

- Use `useSubscriptions()` → `totalMonthly`
- Replace "—" with real value
- Link card → `/app/subscriptions`

### 4. Shared expenses (wire existing)

- Use groups summary API → `totalOwedToMe` and `totalOwedByMe`
- Show: "You’re owed $X" or "You owe $X" or "All settled"
- Link card → `/app/shared`

### 5. Spending trend graph

- Keep current 6‑month area chart
- Ensure it uses real transaction data when linked

### 6. Category breakdown

- Keep current top categories with real data

### 7. Smart insights (real)

Replace placeholders with logic-driven insights:

| Insight | Logic |
|---------|--------|
| **Spending up/down** | "Dining up 23% vs last month" — compare category spend |
| **Subscription renewals** | "3 subs renewed this week" — from subscriptions + dates |
| **Shared balance** | "Alex owes you $86" — from groups summary |
| **Duplicate sub** | "Possible duplicate: Adobe" — from subscription detection |
| **Empty state** | "Connect accounts and sync to see insights" when no data |

---

## Data flow

```
Transactions (Plaid)     → Monthly spend, cash flow, graph, categories
Subscriptions (detected) → Subscriptions card, renewal insights
Groups summary API       → Shared card, "X owes you" insights
```

---

## Implementation order

1. **Phase 1: Wire real data to cards**
   - Subscriptions card: `useSubscriptions`, `totalMonthly`
   - Shared card: fetch `/api/groups/summary`, derive owed/owe
   - Net cash flow: compute income vs expenses from transactions this month

2. **Phase 2: Month-over-month**
   - This month vs last month for spend
   - Optional: same for cash flow

3. **Phase 3: Smart insights**
   - 1–2 real insights (e.g. top category change, shared balance)
   - Graceful empty state when no data

---

## What we’re not doing (yet)

- **Net worth** — needs Plaid account balances; not stored today
- **Budget limits** — no budgeting feature yet
- **Projections** — extrapolation from history; lower priority

---

## Files to touch

| File | Change |
|------|--------|
| `app/app/dashboard/page.tsx` | Wire subscriptions, shared, cash flow; add real insights |
| `hooks/useGroups.ts` or new | Fetch groups summary for dashboard |
| Optional: `app/api/dashboard/summary/route.ts` | Single API for all dashboard metrics if we want to reduce client calls |
