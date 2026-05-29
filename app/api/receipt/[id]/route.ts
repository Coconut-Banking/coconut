export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/** GET /api/receipt/[id] — host resume for collecting / split flow */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: receipt, error } = await db
    .from("receipt_scans")
    .select(`
      id, merchant_name, subtotal, tax, tip, total, status, collect_session_id,
      receipt_items(id, name, quantity, unit_price, total_price, sort_order)
    `)
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const items = (receipt.receipt_items ?? []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order,
  );

  return NextResponse.json({
    id: receipt.id,
    merchantName: receipt.merchant_name,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    tip: receipt.tip,
    total: receipt.total,
    status: receipt.status,
    collectSessionId: receipt.collect_session_id,
    items: items.map(
      (i: {
        id: string;
        name: string;
        quantity: number;
        unit_price: number;
        total_price: number;
      }) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
      }),
    ),
  });
}
