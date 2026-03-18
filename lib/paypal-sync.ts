import { getPayPalAccessToken, PAYPAL_BASE } from "./paypal-auth";
import { getSupabase } from "./supabase";

const MAX_LOOKBACK_DAYS = 730; // 2 years
const WINDOW_DAYS = 31; // PayPal API max window
const RATE_LIMIT_DELAY_MS = 2100; // ~30 calls/min

interface PayPalTransaction {
  transaction_id: string;
  transaction_info: {
    transaction_id: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_updated_date: string;
    transaction_amount: { value: string; currency_code: string };
    transaction_status: string;
    payer_info?: { payer_name?: { given_name?: string; surname?: string }; email_address?: string };
    shipping_info?: { name?: string };
  };
  payer_info?: { payer_name?: { given_name?: string; surname?: string }; email_address?: string };
  cart_info?: { item_details?: Array<{ item_name?: string }> };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync PayPal transactions for a user.
 * Uses 31-day windows, paginated, with rate limiting.
 */
export async function syncPayPalTransactions(clerkUserId: string): Promise<{
  synced: number;
  errors: string[];
}> {
  const accessToken = await getPayPalAccessToken(clerkUserId);
  if (!accessToken) {
    return { synced: 0, errors: ["No valid PayPal access token"] };
  }

  const db = getSupabase();

  // Get last sync point
  const { data: connection } = await db
    .from("paypal_connections")
    .select("last_sync_at, sync_cursor")
    .eq("clerk_user_id", clerkUserId)
    .single();

  const now = new Date();
  let startDate: Date;

  if (connection?.last_sync_at) {
    // Incremental sync: from last sync
    startDate = new Date(connection.last_sync_at);
    // Go back 2 days to catch any delayed settlements
    startDate.setDate(startDate.getDate() - 2);
  } else {
    // First sync: 2-year lookback
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - MAX_LOOKBACK_DAYS);
  }

  let totalSynced = 0;
  const errors: string[] = [];
  let windowStart = new Date(startDate);

  while (windowStart < now) {
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);
    if (windowEnd > now) windowEnd.setTime(now.getTime());

    try {
      const transactions = await fetchTransactionWindow(
        accessToken,
        windowStart.toISOString(),
        windowEnd.toISOString()
      );

      if (transactions.length > 0) {
        const inserted = await upsertTransactions(db, clerkUserId, transactions);
        totalSynced += inserted;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Window ${windowStart.toISOString().slice(0, 10)}: ${msg}`);
      // If rate limited, wait longer
      if (msg.includes("429")) {
        await delay(RATE_LIMIT_DELAY_MS * 3);
      }
    }

    windowStart = new Date(windowEnd);
    await delay(RATE_LIMIT_DELAY_MS);
  }

  // Update sync cursor
  await db
    .from("paypal_connections")
    .update({ last_sync_at: now.toISOString(), sync_cursor: now.toISOString() })
    .eq("clerk_user_id", clerkUserId);

  // Update PayPal balance in manual_accounts
  await syncPayPalBalance(clerkUserId, accessToken);

  return { synced: totalSynced, errors };
}

async function fetchTransactionWindow(
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<PayPalTransaction[]> {
  const all: PayPalTransaction[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      fields: "all",
      page_size: "100",
      page: String(page),
    });

    const res = await fetch(`${PAYPAL_BASE}/v1/reporting/transactions?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("429 rate limited");
      }
      throw new Error(`PayPal API error: ${res.status}`);
    }

    const data = await res.json();
    const transactions = data.transaction_details ?? [];
    all.push(...transactions);
    totalPages = data.total_pages ?? 1;
    page++;

    if (page <= totalPages) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  return all;
}

async function upsertTransactions(
  db: ReturnType<typeof getSupabase>,
  clerkUserId: string,
  transactions: PayPalTransaction[]
): Promise<number> {
  let inserted = 0;

  for (const tx of transactions) {
    const info = tx.transaction_info;
    const payerName = info.payer_info?.payer_name;
    const counterpartyName = payerName
      ? `${payerName.given_name ?? ""} ${payerName.surname ?? ""}`.trim()
      : info.shipping_info?.name ?? "Unknown";

    const note = tx.cart_info?.item_details?.[0]?.item_name ?? null;
    const amount = parseFloat(info.transaction_amount.value);
    const date = info.transaction_initiation_date?.slice(0, 10);
    const status = info.transaction_status?.toLowerCase() === "s" ? "completed" : info.transaction_status ?? "completed";

    if (!date || isNaN(amount)) continue;

    const { error } = await db.from("p2p_transactions").upsert(
      {
        clerk_user_id: clerkUserId,
        platform: "paypal",
        external_id: info.transaction_id,
        date,
        amount,
        counterparty_name: counterpartyName,
        note,
        status,
      },
      { onConflict: "clerk_user_id,platform,external_id" }
    );

    if (!error) inserted++;
  }

  return inserted;
}

async function syncPayPalBalance(clerkUserId: string, accessToken: string) {
  try {
    const res = await fetch(`${PAYPAL_BASE}/v1/reporting/balances`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return;

    const data = await res.json();
    const balances = data.balances ?? [];
    const primaryBalance = balances.find(
      (b: { currency: string }) => b.currency === "USD"
    ) ?? balances[0];

    if (!primaryBalance) return;

    const balance = parseFloat(primaryBalance.total_balance?.value ?? "0");
    const currency = primaryBalance.currency ?? "USD";

    const db = getSupabase();
    await db.from("manual_accounts").upsert(
      {
        clerk_user_id: clerkUserId,
        name: "PayPal",
        platform: "paypal",
        balance,
        iso_currency_code: currency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id,platform,name" }
    );
  } catch {
    // Non-critical: balance sync failure shouldn't block transaction sync
  }
}
