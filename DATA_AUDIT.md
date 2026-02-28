# Data Audit: Dynamic vs Hardcoded

When you're on the **connected (real)** route (bank linked, not demo), only functional/dynamic data appears. Everything else shows empty states.

## Summary

| Page | Dynamic (real) | Demo only / empty when real |
|------|----------------|-----------------------------|
| **Dashboard** | Transactions, chart, categories, monthly spend (derived from Plaid tx) | Cards 2–4 (—), Smart Insights (placeholder) |
| **Transactions** | All from Plaid | — |
| **Subscriptions** | Empty state | All mockData |
| **Shared** | Empty state | All mockData |
| **Settings** | Banks from `/api/plaid/accounts` | Profile, notifications (UI shell) |

## By Page

### Dashboard (when linked)
- **Recent Transactions** → From Plaid ✓
- **Monthly Spend card** → Derived from transactions ✓
- **Subscriptions / Shared / Net Cash Flow cards** → Show "—" + "Coming soon"
- **Monthly Spending chart** → Derived from transactions (or "No spending data yet")
- **Top Categories** → Derived from transactions (or "No category data yet")
- **Smart Insights** → Placeholder: "Coming soon"

### Transactions
- **Full list** → From Plaid ✓

### Subscriptions (when linked)
- **Empty state** → "No subscription data yet. We'll detect recurring charges soon."

### Shared (when linked)
- **Empty state** → "No shared spaces yet. Tag transactions to split when this launches."

### Settings (when linked)
- **Connected banks** → From `/api/plaid/accounts` ✓
- **Profile, security, data** → UI shell (hardcoded defaults)
