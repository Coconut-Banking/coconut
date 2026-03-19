export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/** POST — manually match a receipt to a transaction */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { transactionId } = body;
  if (!transactionId || typeof transactionId !== "string") {
    return NextResponse.json({ error: "transactionId is required" }, { status: 400 });
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

  // Verify transaction ownership
  const { data: transaction, error: txError } = await db
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .eq("clerk_user_id", userId)
    .single();

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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
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
