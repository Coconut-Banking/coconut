import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

// Update parsed items (user corrections after OCR)
export async function PUT(
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
  const { items, subtotal, tax, tip, total, merchant_name, other_fees } = body;

  const db = getSupabase();

  // Verify ownership
  const { data: receipt, error: receiptError } = await db
    .from("receipt_scans")
    .select("id")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  // Update receipt totals
  const updatePayload: Record<string, unknown> = {
    subtotal,
    tax,
    tip,
    total,
    ...(merchant_name ? { merchant_name } : {}),
  };
  if (Array.isArray(other_fees)) {
    updatePayload.other_fees = other_fees;
  }
  await db.from("receipt_scans").update(updatePayload).eq("id", id);

  // Replace all items
  await db.from("receipt_items").delete().eq("receipt_id", id);

  if (Array.isArray(items) && items.length > 0) {
    const itemRows = items.map(
      (
        item: {
          name: string;
          quantity: number;
          unit_price: number;
          total_price: number;
        },
        idx: number
      ) => ({
        receipt_id: id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        sort_order: idx,
      })
    );
    await db.from("receipt_items").insert(itemRows);
  }

  // Fetch updated receipt
  const { data: updated } = await db
    .from("receipt_scans")
    .select("*, receipt_items(*)")
    .eq("id", id)
    .single();

  return NextResponse.json(updated);
}
