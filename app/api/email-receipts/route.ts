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

export async function GET() {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getSupabase();

    const { data: receipts, error } = await db
      .from("email_receipts")
      .select("id, clerk_user_id, merchant, merchant_type, amount, currency, date, transaction_id, raw_from, parsed_at")
      .eq("clerk_user_id", userId)
      .order("parsed_at", { ascending: false })
      .limit(EMAIL_RECEIPTS.PAGE_SIZE);

    if (error) {
      console.error("Failed to fetch receipts:", error);
      return NextResponse.json({ error: "Failed to fetch receipts" }, { status: 500 });
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

    return NextResponse.json(
      { receipts: filtered, count: filtered.length },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=30" } }
    );
  } catch (e) {
    console.error("Error fetching receipts:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}