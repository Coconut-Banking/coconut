# Splitwise API Guide

How to connect to Splitwise and manage expenses programmatically — using the existing client in `lib/splitwise.ts`.

---

## How Claude Code can use this directly

The Supabase DB stores your encrypted Splitwise access token. Claude Code can decrypt it and make live API calls without any OAuth flow. This is how expenses like "Shina's plane ticket" were added mid-conversation.

### Get your access token

```ts
// 1. Fetch encrypted token from Supabase
const res = await fetch(
  "https://dmkyfsbelatkemjfdnft.supabase.co/rest/v1/splitwise_tokens?select=*&limit=1",
  {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  }
);
const [row] = await res.json();

// 2. Decrypt it
import { decryptToken } from "@/lib/encryption";
const accessToken = decryptToken(row.access_token);
```

Or via Claude Code in a session — just ask "use my Splitwise token from the DB" and it can do the above automatically using the service role key in `.env.local`.

---

## Authentication (OAuth flow — for new users)

If you need to connect a **new** account (not yours), the OAuth flow is already built:

1. User visits `/api/splitwise/connect` → redirected to Splitwise OAuth
2. User approves → callback hits `/api/splitwise/callback`
3. Token is encrypted and stored in `splitwise_tokens` table

To trigger it manually:
```
https://your-app-url/api/splitwise/connect
```

---

## Reading data

All functions are in `lib/splitwise.ts`. Pass the decrypted `accessToken` to each.

### Get your groups
```ts
import { getGroups } from "@/lib/splitwise";

const groups = await getGroups(accessToken);
// Returns all groups (excluding id=0 which is "non-group expenses")
groups.forEach(g => console.log(g.id, g.name, g.members.map(m => m.first_name)));
```

### Get a specific group
```ts
import { getGroup } from "@/lib/splitwise";

const group = await getGroup(accessToken, 96149197); // San Diego
```

### Get friends + balances
```ts
import { getFriends } from "@/lib/splitwise";

const friends = await getFriends(accessToken);
friends.forEach(f => console.log(f.first_name, f.balance));
```

### Get expenses in a group
```ts
import { getExpenses } from "@/lib/splitwise";

const expenses = await getExpenses(accessToken, 96149197, {
  limitPerPage: 200,
  datedAfter: "2026-01-01",  // optional ISO date filter
});
```

---

## Adding expenses

### Split equally between you and one person
```ts
import { createSwExpense } from "@/lib/splitwise";

// You paid $228.40, Shina owes it all
const { id } = await createSwExpense(accessToken, {
  group_id: 96149197,        // San Diego group
  description: "Shina ticket",
  cost: "228.40",
  currency_code: "USD",
  users: [
    {
      user_id: 99117235,     // your Splitwise user ID (Koushik)
      paid_share: "228.40",
      owed_share: "0.00",
    },
    {
      user_id: 118834875,    // Shina's user ID
      paid_share: "0.00",
      owed_share: "228.40",
    },
  ],
});

console.log("Created expense ID:", id);
```

### Split equally among a whole group
```ts
const members = group.members; // from getGroup()
const total = 120.00;
const perPerson = (total / members.length).toFixed(2);

// Figure out rounding — give any leftover cents to the first person
const owedShares = members.map((_, i) => perPerson);
const owedTotal = parseFloat(perPerson) * members.length;
if (owedTotal < total) {
  owedShares[0] = (parseFloat(owedShares[0]) + (total - owedTotal)).toFixed(2);
}

await createSwExpense(accessToken, {
  group_id: group.id,
  description: "Dinner",
  cost: total.toFixed(2),
  currency_code: "USD",
  users: members.map((m, i) => ({
    user_id: m.id,
    paid_share: m.id === 99117235 ? total.toFixed(2) : "0.00", // you paid
    owed_share: owedShares[i],
  })),
});
```

### Mark a payment (settle up)
```ts
await createSwExpense(accessToken, {
  group_id: 96149197,
  description: "Settle up",
  cost: "50.00",
  currency_code: "USD",
  payment: true,             // marks this as a payment, not an expense
  users: [
    { user_id: 99117235, paid_share: "50.00", owed_share: "0.00" },
    { user_id: 118834875, paid_share: "0.00", owed_share: "50.00" },
  ],
});
```

---

## Updating and deleting expenses

```ts
import { updateSwExpense, deleteSwExpense } from "@/lib/splitwise";

// Fix a typo or wrong amount
await updateSwExpense(accessToken, expenseId, {
  description: "Shina plane ticket",
  cost: "230.00",
});

// Delete an expense
await deleteSwExpense(accessToken, expenseId);
```

---

## Creating a new group

```ts
import { createSwGroup, addUserToSwGroup } from "@/lib/splitwise";

const { id: newGroupId } = await createSwGroup(accessToken, "Trip to Austin", "trip");

// Add someone by email
await addUserToSwGroup(accessToken, newGroupId, {
  email: "friend@example.com",
  first_name: "Friend",
});

// Add someone by their Splitwise user ID (if already a friend)
await addUserToSwGroup(accessToken, newGroupId, {
  user_id: 99117255, // Aaran
});
```

---

## Your key IDs

These are hardcoded for convenience — no need to look them up.

| Person | Splitwise User ID |
|--------|------------------|
| Koushik (you) | `99117235` |
| Aaran | `99117255` |
| Harshil | `99117266` |
| Shammas | `58175483` |
| Sanjae | `41970446` |
| Aryan | `76209381` |
| Shina | `118834875` |
| Ashnoor | `106582710` |
| Kevin | `118866464` |
| Sid | `119402197` |
| Seonwoo | `62157283` |

| Group | Splitwise Group ID |
|-------|-------------------|
| San Diego | `96149197` |
| Seattle | `95626029` |
| Project Cracker | `87342710` |
| Grand Canyon Vegas Feb 2026 | `94076395` |
| Yosemite | `95516142` |
| Niagara 2025 | `88872373` |
| NYC 2024 | `75408135` |
| Portugal 2025 | `86843142` |

---

## Running as a script

You can run any of this as a standalone script using the service role key directly:

```bash
npx tsx scripts/shadow-write-expenses.ts
```

Or write a one-off script:

```ts
// scripts/add-expense.ts
import { createSwExpense } from "../lib/splitwise";
import { decryptToken } from "../lib/encryption";

const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY!;
const ENCRYPTED = "W4AawRAlk/..."; // from splitwise_tokens table

process.env.TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
const token = decryptToken(ENCRYPTED);

await createSwExpense(token, {
  group_id: 96149197,
  description: "Groceries",
  cost: "45.00",
  currency_code: "USD",
  users: [
    { user_id: 99117235, paid_share: "45.00", owed_share: "22.50" },
    { user_id: 99117255, paid_share: "0.00", owed_share: "22.50" },
  ],
});
```

```bash
TOKEN_ENCRYPTION_KEY=be9d4e55... npx tsx scripts/add-expense.ts
```

---

## API reference

Full Splitwise API docs: https://dev.splitwise.com/

All implemented functions in `lib/splitwise.ts`:

| Function | What it does |
|----------|-------------|
| `getGroups(token)` | All your groups |
| `getGroup(token, groupId)` | Single group with members + debts |
| `getFriends(token)` | All friends with balances |
| `getExpenses(token, groupId, options)` | Paginated expenses for a group |
| `createSwExpense(token, params)` | Create a new expense |
| `updateSwExpense(token, expenseId, params)` | Update an existing expense |
| `deleteSwExpense(token, expenseId)` | Delete an expense |
| `createSwGroup(token, name, type)` | Create a new group |
| `addUserToSwGroup(token, groupId, user)` | Add user to a group |
