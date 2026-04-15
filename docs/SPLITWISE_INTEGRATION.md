# Splitwise Integration Plan

## Overview

Full two-way Splitwise integration — import group data, show balances on the dashboard, and optionally push splits from Coconut back to Splitwise.

## Prerequisites

- [ ] Register Splitwise OAuth app at https://dev.splitwise.com/
- [ ] Add `SPLITWISE_CLIENT_ID` and `SPLITWISE_CLIENT_SECRET` to env
- [ ] Set callback URL to `{APP_URL}/api/splitwise/callback`

## Already Built

- `lib/splitwise.ts` — OAuth flow, API client (`getGroups`, `getExpenses`, `getCurrentUser`)
- `app/api/splitwise/connect/route.ts` — Initiates OAuth
- `app/api/splitwise/callback/route.ts` — Handles callback, stores encrypted token
- `supabase/migrations/20260323_splitwise_import.sql` — `splitwise_tokens` table with RLS
- Settings page has Connect/Disconnect Splitwise button

## Phase 1: Group & Balance Import (read-only)

### Goal
Show Splitwise group balances on the Coconut dashboard. "You owe Aaran $42.50" / "Harshil owes you $18.00".

### API Endpoints to Use
- `GET /get_current_user` — Get the authenticated user's Splitwise ID
- `GET /get_groups` — All groups with members and `simplified_debts`
- `GET /get_friends` — All friends with overall balances

### New DB Tables

```sql
create table splitwise_groups (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  splitwise_group_id integer not null,
  name text not null,
  members jsonb not null default '[]',
  simplified_debts jsonb not null default '[]',
  synced_at timestamptz not null default now(),
  unique(clerk_user_id, splitwise_group_id)
);

create table splitwise_balances (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  friend_name text not null,
  friend_id integer not null,
  amount numeric not null,        -- positive = they owe you, negative = you owe them
  currency_code text not null default 'USD',
  group_name text,                -- null = overall balance
  splitwise_group_id integer,
  synced_at timestamptz not null default now(),
  unique(clerk_user_id, friend_id, splitwise_group_id)
);
```

### API Routes
- `POST /api/splitwise/sync` — Fetch groups + friends, upsert balances
- `GET /api/splitwise/balances` — Return current balances for dashboard
- `GET /api/splitwise/groups` — Return groups with members and debts

### UI
- Dashboard widget: "Splitwise Balances" card showing who owes who
- Settings page: sync status, last synced timestamp, manual sync button
- Auto-sync on dashboard load if last sync > 6 hours ago (same pattern as Gmail)

### Implementation Steps
1. Add `splitwise_groups` and `splitwise_balances` tables (migration)
2. Build `lib/splitwise-sync.ts` — fetches groups/friends, computes balances, upserts
3. Add `POST /api/splitwise/sync` route
4. Add `GET /api/splitwise/balances` route
5. Add dashboard balance widget component
6. Add auto-sync trigger on dashboard load

## Phase 2: Expense History Import

### Goal
Import Splitwise expense history as transactions in Coconut so they show up in the transaction list and analytics.

### API Endpoints to Use
- `GET /get_expenses?group_id=X&limit=500` — All expenses in a group
- Already built in `lib/splitwise.ts`

### Logic
- For each expense, calculate the user's net amount (paid_share - owed_share)
- Positive = user paid more than their share (expense)
- Negative = user owes (liability, skip or show differently)
- Store as `split_transactions` with `source = 'splitwise'`
- Deduplicate on `external_id = splitwise_expense_id`
- Skip settlement payments (`payment: true`)

### Implementation Steps
1. Build `lib/splitwise-import.ts` — processes expenses into split_transactions
2. Add group selector UI — let user pick which groups to import
3. Add "Import Expenses" button per group
4. Show imported expenses in transaction list with Splitwise badge

## Phase 3: Two-Way Sync (push to Splitwise)

### Goal
When a user splits a transaction in Coconut, optionally create the expense in Splitwise too.

### API Endpoints to Use
- `POST /create_expense` — Create a new expense in Splitwise
- Requires: cost, description, group_id, date, currency_code, users (shares)

### Logic
- When user splits a Coconut transaction and has Splitwise connected
- Show toggle: "Also create in Splitwise?"
- Map Coconut group members to Splitwise group members (by name/email)
- Push the expense with correct shares
- Store the returned `splitwise_expense_id` for dedup

### Implementation Steps
1. Add Splitwise member mapping (match Coconut group members to Splitwise users)
2. Add "Push to Splitwise" toggle in split flow
3. Build `lib/splitwise-push.ts` — creates expense via API
4. Store external_id linkage for dedup

## Phase 4: Real-Time Balance Widget

### Goal
Always-visible balance summary — "You owe $X total" / "You're owed $X total".

### UI
- Sidebar or dashboard card with net position
- Expandable to show per-friend breakdown
- Color-coded: red (you owe), green (owed to you)
- Quick-settle button linking to Splitwise or triggering in-app payment

## Data Flow

```
Splitwise API
     |
     v
lib/splitwise-sync.ts  -->  splitwise_balances (dashboard widget)
lib/splitwise-import.ts -->  split_transactions (transaction list)
lib/splitwise-push.ts  <--  Coconut split flow (two-way)
```

## Rate Limits & Caching

- Splitwise doesn't publish exact rate limits but warns about "conservative limits"
- Cache group/balance data in DB, refresh on manual sync or auto-sync (6hr interval)
- Batch expense fetches per group, max 500 per request
- Store `synced_at` timestamps to avoid redundant fetches
