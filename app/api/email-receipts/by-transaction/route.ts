export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET(request: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId required" }, { status: 400 });
  }

  const db = getSupabase();
  const { data, error } = await db
    .from("email_receipts")
    .select("id, transaction_id, clerk_user_id, merchant, raw_subject, receipt_date, total, subtotal, tax, tip, merchant_type, merchant_details, created_at")
    .eq("clerk_user_id", userId)
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch receipt" }, { status: 500 });
  }

  return NextResponse.json({ receipt: data }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}
