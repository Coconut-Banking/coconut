/**
 * Fetches one real transaction from Plaid Sandbox and prints full metadata.
 * Run from project root: npx tsx scripts/mock-plaid-tx.ts
 *
 * Requires PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET in .env.local (and PLAID_ENV=sandbox).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env.local so Plaid config is available (no dotenv dep)
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

import { PlaidApi, PlaidEnvironments, Configuration, Products } from "plaid";

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SANDBOX_SECRET;

if (!clientId || !secret) {
  console.error("Missing PLAID_CLIENT_ID or PLAID_SANDBOX_SECRET. Set them in .env.local");
  process.exit(1);
}

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret },
  },
});
const plaid = new PlaidApi(configuration);

async function main() {
  // 1. Create sandbox public token with custom user that has explicit transactions
  // (so first sync returns data; user_transactions_dynamic can be NOT_READY initially)
  const customPassword = JSON.stringify({
    override_accounts: [
      {
        type: "depository",
        subtype: "checking",
        balance: 1000,
        transactions: [
          {
            date_transacted: "2025-03-10",
            date_posted: "2025-03-10",
            amount: -12.5,
            description: "Chipotle 1234",
            currency: "USD",
          },
        ],
      },
    ],
  });
  const { data: tokenData } = await plaid.sandboxPublicTokenCreate({
    institution_id: "ins_109508",
    initial_products: [Products.Transactions],
    options: {
      override_username: "user_custom",
      override_password: customPassword,
    },
  });

  // 2. Exchange for access token
  const { data: exchangeData } = await plaid.itemPublicTokenExchange({
    public_token: tokenData.public_token,
  });
  const accessToken = exchangeData.access_token;

  // 3. Sync until we get transactions (sandbox can return NOT_READY at first)
  let cursor: string | undefined;
  let syncData: Awaited<ReturnType<PlaidApi["transactionsSync"]>>["data"];
  for (let i = 0; i < 8; i++) {
    const res = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 50,
    });
    syncData = res.data;
    const added = (syncData.added ?? []) as unknown as Record<string, unknown>[];
    const modified = (syncData.modified ?? []) as unknown as Record<string, unknown>[];
    const firstTx = added[0] ?? modified[0];
    if (firstTx) {
      console.log("--- One transaction from Plaid (full metadata) ---\n");
      console.log(JSON.stringify(firstTx, null, 2));
      console.log("\n--- End ---");
      return;
    }
    if (!syncData.has_more && syncData.transactions_update_status === "HISTORICAL_UPDATE_COMPLETE") break;
    cursor = syncData.next_cursor ?? undefined;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Fallback: try /transactions/get (sometimes works when sync is NOT_READY)
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  try {
    const getRes = await plaid.transactionsGet({
      access_token: accessToken,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      options: { count: 10 },
    });
    const txs = (getRes.data.transactions ?? []) as unknown as Record<string, unknown>[];
    if (txs[0]) {
      console.log("--- One transaction from Plaid /transactions/get (full metadata) ---\n");
      console.log(JSON.stringify(txs[0], null, 2));
      console.log("\n--- End ---");
      return;
    }
  } catch {
    // ignore
  }

  // Sandbox often stays NOT_READY; show canonical shape so you still see full metadata
  console.log("Sandbox returned no transactions (NOT_READY). Example full metadata shape from Plaid:\n");
  console.log(JSON.stringify(MOCK_FULL_TX, null, 2));
  console.log("\n--- See docs/PLAID_TRANSACTION_METADATA.md for field reference ---");
}

/** Example transaction shape (all fields Plaid can return per tx). */
const MOCK_FULL_TX: Record<string, unknown> = {
  transaction_id: "txn_abc123",
  pending_transaction_id: null,
  account_id: "acc_xyz",
  amount: -12.5,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
  date: "2025-03-10",
  authorized_date: "2025-03-10",
  name: "CHIPOTLE 1234",
  merchant_name: "Chipotle",
  pending: false,
  category: ["Food and Drink", "Restaurants"],
  category_id: "13005043",
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "RESTAURANTS",
    confidence_level: "VERY_HIGH",
  },
  payment_channel: "in store",
  payment_meta: {
    payment_processor: "square",
    payer: null,
    payee: null,
    payment_method: null,
    reference_number: null,
    reason: null,
  },
  location: {
    address: "123 Main St",
    city: "San Francisco",
    region: "CA",
    postal_code: "94102",
    country: "US",
  },
  counterparties: [{ name: "Chipotle", type: "merchant" }],
  merchant_entity_id: "ent_merchant_123",
  check_number: null,
  datetime: "2025-03-10T12:34:56Z",
  transaction_code: null,
  personal_finance_category_icon: "🍽️",
  sic_code: "5812",
  website: "https://chipotle.com",
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
