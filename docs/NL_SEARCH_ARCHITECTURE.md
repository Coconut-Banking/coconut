# Natural Language Transaction Search — Architecture

## Goal

Query transactions in plain English: *"Find that Uber from last month"*, *"Coffee in January"*, *"Subscriptions over $10"*.

---

## Simplest Architecture (Phase 1)

```
┌──────────────────────────────────────────────────────────────────┐
│  User types query (header or transactions page)                    │
│  "dinner with Alex in January"                                    │
└─────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  lib/nl-query.ts: parseQuery(query) → QueryFilters                │
│  • keywords: ["dinner", "alex"]  — search merchant, category, raw │
│  • dateRange: { start, end }    — "last month", "January"         │
│  • amountMin/Max                — "over $10", "under $50"         │
│  • category hint                — "subscriptions" → category     │
└─────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  filterTransactions(transactions, filters) → filtered[]            │
│  Client-side only. Transactions from useTransactions (Plaid/mock) │
└──────────────────────────────────────────────────────────────────┘
```

**No API calls. No LLM. No embeddings.** Just regex + date math.

---

## What We Parse

| Query pattern        | Example                    | Extracted              |
|----------------------|----------------------------|------------------------|
| Keywords             | "Uber" "coffee" "Netflix"  | Search merchant/category/raw |
| Relative dates       | "last month" "this week"   | dateRange              |
| Month names          | "January" "in February"    | dateRange              |
| Amounts              | "over $50" "under $20"     | amountMin/Max          |
| Category hints       | "subscriptions" "dining"   | category filter        |

---

## Data Flow

1. **Transactions** → From `useTransactions()` (Plaid API or mock). Already in memory.
2. **Query** → From header search input or transactions page input.
3. **Parse** → `parseQuery(q)` returns structured filters.
4. **Filter** → `filterTransactions(tx, filters)` returns matching transactions.
5. **Display** → Same list UI, just filtered.

---

## Phase 2 (Later)

- **LLM extraction**: Call OpenAI/Anthropic to parse complex queries → structured JSON. Same filter pipeline.
- **Server-side**: Move parsing to `/api/search?q=...` if we add LLM or want to hide logic.

---

## Files

| File               | Role                                      |
|--------------------|-------------------------------------------|
| `lib/nl-query.ts`  | parseQuery(), filterTransactions()        |
| Transactions page  | Uses nl-query instead of simple includes  |
| AppLayout header   | On submit → `/app/transactions?q=...`      |
