export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

/** POST — manually match a receipt to a transaction */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params + body parse (independent)
  const [userId, { id }, bodyRaw] = await Promise.all([
    getEffectiveUserId(),
    params,
    req.json().catch(() => null),
  ]);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (bodyRaw === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { transactionId } = bodyRaw as { transactionId?: string };
  if (!transactionId || typeof transactionId !== "string") {
    return NextResponse.json({ error: "transactionId is required" }, { status: 400 });
  }

  const db = getSupabase();

  // Verify receipt + transaction ownership in parallel
  const [
    { data: receipt, error: receiptError },
    { data: transaction, error: txError },
  ] = await Promise.all([
    db
      .from("email_receipts")
      .select("id")
      .eq("id", id)
      .eq("clerk_user_id", userId)
      .single(),
    db
      .from("transactions")
      .select("id")
      .eq("id", transactionId)
      .eq("clerk_user_id", userId)
      .single(),
  ]);

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  if (txError || !transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // Update receipt with the matched transaction
  const { error: updateError } = await db
    .from("email_receipts")
    .update({ transaction_id: transactionId })
    .eq("id", id)
    .eq("clerk_user_id", userId);

  if (updateError) {
    console.error("Failed to match receipt:", updateError);
    return NextResponse.json({ error: "Failed to match receipt" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE — unmatch a receipt from its transaction */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params (independent)
  const [userId, { id }] = await Promise.all([getEffectiveUserId(), params]);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabase();

  // Verify receipt ownership
  const { data: receipt, error: receiptError } = await db
    .from("email_receipts")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // Clear the match
  const { error: updateError } = await db
    .from("email_receipts")
    .update({ transaction_id: null })
    .eq("id", id)
    .eq("clerk_user_id", userId);

  if (updateError) {
    console.error("Failed to unmatch receipt:", updateError);
    return NextResponse.json({ error: "Failed to unmatch receipt" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
