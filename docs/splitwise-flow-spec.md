# Splitwise Flow & Functionality — Implementation Spec for Coconut

**Source:** Splitwise API docs, product site, help center.  
**Purpose:** Map Splitwise's flows to Coconut so we can implement parity without screenshots/verbal walkthroughs.

---

## 1. Splitwise Core Flows (Reference)

### 1.1 Account & Friends
| Flow | Splitwise | Notes |
|------|-----------|-------|
| Sign up | Email/social | Clerk handles auth |
| Add friends | By email; can add non-users (first_name, last_name, email) | Friends have 1:1 balance outside groups |
| List friends | `/get_friends` — balance per friend, per-group balances | |
| Delete friend | Break friendship | |

### 1.2 Groups
| Flow | Splitwise | Notes |
|------|-----------|-------|
| Create group | Name, type (home/trip/couple/other), simplify_by_default, add members (user_id or email+name) | |
| List groups | `/get_groups` — members, balances, original_debts, simplified_debts, invite_link | Group ID 0 = expenses outside groups |
| Add user to group | By user_id or email+name | |
| Remove user | Only if balance is 0 | |
| Delete group | Destroys expenses too | |
| Invite link | Public join URL | |

### 1.3 Expenses
| Flow | Splitwise | Notes |
|------|-----------|-------|
| Add expense | `cost`, `description`, `group_id` (or 0), `split_equally` or `users__{i}__paid_share` + `owed_share` | **Who paid** can be anyone; **who owes** per user |
| Create modes | Equal (with group), or custom shares (paid_share, owed_share per user) | paid_share = amount paid; owed_share = amount owes |
| Optional | details (notes), date, repeat_interval, currency, category_id, receipt | |
| List expenses | By group_id, friend_id, date range | |
| Update expense | Same params; shares overwritten if provided | |
| Delete expense | Soft/hard delete | |

### 1.4 Settlements
| Flow | Splitwise | Notes |
|------|-----------|-------|
| Settle up | Record payment (cash or PayPal/Venmo in-app) | payer → receiver, amount |
| Payment methods | Manual (cash), PayPal, Venmo | |

### 1.5 Debt Logic
- Net balance per user: total paid − total owed, adjusted by settlements.
- **Simplification:** Minimize number of transactions (greedy creditor/debtor matching).
- Display: total balance, suggested repayments.

---

## 2. Coconut Current State vs Splitwise

| Area | Coconut | Gap |
|------|---------|-----|
| **Groups** | groups, group_members (owner_id, invite by email) | ✓ Mostly aligned. Missing: group_type, invite_link, simplify_by_default |
| **Friends (1:1)** | None | Need: "Friends" = people with shared expenses outside a named group. Could be a built-in group or separate concept. |
| **Add expense (manual)** | `/api/manual-expense` — amount, description, groupId, personKey (2-way split) | **Payer is always current user.** No "Alice paid, I owe" |
| **Add expense (bank tx)** | Link existing Plaid tx to group + shares | Payer = tx owner. No way to reassign "who paid" |
| **Splits** | Equal (all members or 2 people), or custom per split_transactions | Custom amounts per member ✓. No % or shares (1:2:3) |
| **Shares model** | split_shares: member_id, amount (owed) | Payer inferred from transaction.clerk_user_id. No explicit paid_share stored |
| **Settlements** | settlements (payer, receiver, amount, method, status) | ✓ Aligned |
| **Debt simplification** | lib/split-balances.ts (Spliit-style) | ✓ Aligned |
| **Recurring** | No | Splitwise: never/weekly/fortnightly/monthly/yearly |
| **Categories** | Plaid categories on tx | Splitwise has expense categories (Electricity, etc.) |
| **Receipt photo** | receipt parsing exists | Could attach to manual expenses |

---

## 3. Implementation Phases

### Phase 1: Flow parity (minimal)
1. **"Add bill" from Shared** — Prominent "Add expense" (like Add bill). Already exists but ensure it's the primary CTA.
2. **Pick who paid** — Extend manual-expense to accept `payerMemberId` or `paidByUserId`. If omitted, current user pays.
3. **Friends / non-group expenses** — Either:
   - Use a special group "Friends" (group_id for 1:1), or
   - Allow group_id = null and store friendship_id equivalent (e.g. expense between 2 members without a named group).
   - Simplest: create a default "Friends" group per user for 1:1 splits.
4. **Settle up UX** — Match Splitwise: "You owe X $Y" → "Settle up" → amount, method. Already have settlements; ensure UI mirrors this.

### Phase 2: Split flexibility
5. **Unequal / custom splits** — Manual expense: allow editing each person's "you owe" amount (not just equal or 50/50).
6. **Split by % or shares** — Optional: "Split by percentage" or "Split 1:2:3" (shares). Compute owed from that.

### Phase 3: Polish
7. **Group types** — Add group_type (home, trip, couple) for display/icon.
8. **Invite link** — Public join link for groups.
9. **Recurring expenses** — repeat_interval, next_repeat.
10. **Receipt on manual expense** — Optional image upload.

---

## 4. Data Model Changes (if needed)

| Change | Reason |
|--------|--------|
| `split_transactions.paid_by_member_id` or `payer_member_id` | Support "Alice paid" when Alice didn't create the expense. Currently payer = tx.clerk_user_id. |
| `groups.group_type` | home, trip, couple for UX |
| `groups.invite_token` | For public invite links |
| Expenses without group | For friend-to-friend expenses. Could use group_id = NULL and a "friendship" or 2-member virtual group. |
| `split_shares` | Already stores owed amount. For "paid_share" we derive from tx owner. If we add payer_member_id, we need to handle case where payer ≠ tx creator (manual expense created by Bob, Alice paid). |

---

## 5. UX Flow Checklist (Splitwise-like)

- [ ] **Dashboard/Home**: Total you owe / owed to you, list of groups/friends with balances
- [ ] **Group detail**: Balance summary, suggested settlements, expense list, "Add expense" CTA
- [ ] **Add expense**: Amount, description, who paid, split (equal / custom), date, optional notes
- [ ] **Person detail**: Balance with that person, expense history, "Settle up" CTA
- [ ] **Settle up**: Amount (pre-filled from suggestion), method (cash/manual), confirm
- [ ] **Create group**: Name, add members (email), optional type
- [ ] **Invite to group**: Link or email invite

---

## 6. API-to-Flow Mapping (for implementation)

When building a feature, use this mapping:

| Splitwise endpoint | Coconut equivalent |
|--------------------|--------------------|
| `get_groups` | `GET /api/groups` + summary balances |
| `create_group` | `POST /api/groups` |
| `get_expenses` (group_id) | `GET /api/groups/[id]` (includes splits) or recent-activity |
| `create_expense` | `POST /api/manual-expense` (extend with payer, custom shares) + `POST /api/split-transactions` (for bank tx) |
| `get_friend` / `get_friends` | Person detail = member in shared groups; or Friends group |
| Settle up | `POST /api/groups/[id]/settlements` or `/api/settlements` |

---

## 7. Quick wins (no schema change)

1. Make "Add expense" the main CTA on Shared page (like Splitwise "Add bill").
2. Default to "Split equally" and show clear "Who paid" = you (with option to add "Someone else paid" later).
3. Show "Settle up" with suggested amount prominently.
4. Add group_type enum (home/trip/couple) to groups table and show icon in UI.

---

*Generated from Splitwise API docs and product research. Use this as the source of truth for implementation; no screenshots needed.*
