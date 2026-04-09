export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { EMAIL_RECEIPTS, GMAIL } from "@/lib/config";
import { getEffectiveUserId } from "@/lib/demo";

function isExcludedReceipt(rawFrom: string | null, merchant: string | null): boolean {
  const from = (rawFrom ?? "").toLowerCase();
  const merch = (merchant ?? "").toLowerCase();
  return (
    GMAIL.EXCLUDED_SENDERS.some((d) => from.includes(d)) ||
    GMAIL.EXCLUDED_SENDERS.some((d) => merch.includes(d.replace(".com", "")))
  );
}

const RECEIPT_COLUMNS = [
  "id", "clerk_user_id", "merchant", "merchant_type", "amount",
  "date", "transaction_id", "raw_from", "raw_subject", "match_source", "parsed_at",
].join(", ");

export async function GET() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getSupabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let receipts: any[] | null = null;

    const primary = await db
      .from("email_receipts")
      .select(RECEIPT_COLUMNS)
      .eq("clerk_user_id", userId)
      .order("date", { ascending: false })
      .limit(EMAIL_RECEIPTS.PAGE_SIZE);

    if (primary.error) {
      console.error("Failed to fetch receipts:", primary.error.message, primary.error.code, primary.error.details);
      const fallback = await db
        .from("email_receipts")
        .select("id, clerk_user_id, merchant, amount, date, transaction_id, raw_from")
        .eq("clerk_user_id", userId)
        .order("date", { ascending: false })
        .limit(EMAIL_RECEIPTS.PAGE_SIZE);
      if (fallback.error) {
        return NextResponse.json(
          { error: "Failed to fetch receipts", detail: fallback.error.message },
          { status: 500 },
        );
      }
      receipts = fallback.data;
    } else {
      receipts = primary.data;
    }

    const filtered = (receipts || []).filter(
      (r) => !isExcludedReceipt(r.raw_from, r.merchant)
    );

    // Validate that matched transaction_ids point to existing transactions
    // owned by THIS user (catches stale matches AND cross-user matches)
    const linkedTxIds = filtered
      .map((r) => r.transaction_id)
      .filter(Boolean) as string[];
    if (linkedTxIds.length > 0) {
      const { data: validTxRows } = await db
        .from("transactions")
        .select("id")
        .in("id", linkedTxIds)
        .eq("clerk_user_id", userId);
      const validTxIds = new Set((validTxRows ?? []).map((t) => t.id as string));
      for (const r of filtered) {
        if (r.transaction_id && !validTxIds.has(r.transaction_id)) {
          r.transaction_id = null;
        }
      }
    }

    return NextResponse.json({
      receipts: filtered,
      count: filtered.length,
    }, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch (e) {
    console.error("Error fetching receipts:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}