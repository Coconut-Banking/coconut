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

  // Update sync cursor and balance in parallel (independent operations)
  await Promise.all([
    // Update sync cursor only if there were no errors or some transactions were synced.
    // This prevents permanently skipping a date range when PayPal is down.
    (errors.length === 0 || totalSynced > 0)
      ? db
          .from("paypal_connections")
          .update({ last_sync_at: now.toISOString(), sync_cursor: now.toISOString() })
          .eq("clerk_user_id", clerkUserId)
      : Promise.resolve(),
    // Update PayPal balance in manual_accounts
    syncPayPalBalance(clerkUserId, accessToken),
  ]);

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(`${PAYPAL_BASE}/v1/reporting/transactions?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

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
  // Phase 1: resolve all transaction data and Plaid match lookups in parallel
  type TxParsed = {
    counterpartyName: string;
    note: string | null;
    amount: number;
    date: string;
    externalId: string;
  };

  const parsed = transactions.map((tx) => {
    const info = tx.transaction_info;
    const payerName = info.payer_info?.payer_name;
    const counterpartyName = payerName
      ? `${payerName.given_name ?? ""} ${payerName.surname ?? ""}`.trim()
      : info.shipping_info?.name ?? "Unknown";
    const note = tx.cart_info?.item_details?.[0]?.item_name ?? null;
    const amount = info.transaction_amount?.value != null
      ? parseFloat(info.transaction_amount.value)
      : NaN;
    const date = info.transaction_initiation_date?.slice(0, 10);
    return { counterpartyName, note, amount, date, externalId: info.transaction_id };
  }).filter((p): p is TxParsed & { date: string } => !!p.date && !isNaN(p.amount));

  const plaidMatchResults = await Promise.all(
    parsed.map(({ amount, date }) => {
      const txDate = new Date(date);
      const dayBefore = new Date(txDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(txDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      return db
        .from("transactions")
        .select("id, amount")
        .eq("clerk_user_id", clerkUserId)
        .eq("source", "plaid")
        .gte("date", dayBefore.toISOString().slice(0, 10))
        .lte("date", dayAfter.toISOString().slice(0, 10))
        .ilike("merchant_name", "%paypal%")
        .then((r) => (r.data ?? []).filter(
          (m) => Math.abs(Math.abs(m.amount) - Math.abs(amount)) <= 0.02
        ));
    })
  );

  // Phase 2: batch updates and upserts
  const updates: Array<{ id: string; data: { p2p_counterparty: string; p2p_note: string | null; p2p_platform: string } }> = [];
  const upserts: object[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const { counterpartyName, note, amount, date, externalId } = parsed[i];
    const amountMatches = plaidMatchResults[i];

    if (amountMatches.length === 1) {
      updates.push({
        id: amountMatches[0].id,
        data: { p2p_counterparty: counterpartyName, p2p_note: note, p2p_platform: "paypal" },
      });
    } else {
      upserts.push({
        clerk_user_id: clerkUserId,
        source: "paypal",
        external_id: externalId,
        date,
        amount,
        merchant_name: counterpartyName,
        raw_name: counterpartyName,
        p2p_counterparty: counterpartyName,
        p2p_note: note,
        p2p_platform: "paypal",
        primary_category: amount > 0 ? "TRANSFER_IN" : "TRANSFER_OUT",
      });
    }
  }

  // Execute in parallel
  const [updateResults, upsertResult] = await Promise.all([
    Promise.all(
      updates.map((u) =>
        db.from("transactions").update(u.data).eq("id", u.id).then((r) => !r.error)
      )
    ),
    upserts.length > 0
      ? db.from("transactions").upsert(upserts, { onConflict: "clerk_user_id,source,external_id" }).then((r) => !r.error ? upserts.length : 0)
      : Promise.resolve(0),
  ]);

  return updateResults.filter(Boolean).length + (typeof upsertResult === "number" ? upsertResult : 0);
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
