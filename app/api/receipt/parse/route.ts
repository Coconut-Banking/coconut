import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { parseReceiptImage } from "@/lib/receipt-ocr";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "image file required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/png";

  // Parse with GPT-4o Vision
  const parsed = await parseReceiptImage(base64, mimeType);

  const db = getSupabase();

  // Save receipt scan
  const { data: receipt, error: receiptErr } = await db
    .from("receipt_scans")
    .insert({
      clerk_user_id: userId,
      merchant_name: parsed.merchant_name,
      receipt_date: parsed.date,
      subtotal: parsed.subtotal,
      tax: parsed.tax,
      tip: parsed.tip,
      total: parsed.total,
      image_base64: `data:${mimeType};base64,${base64}`,
      status: "parsed",
    })
    .select("id")
    .single();

  if (receiptErr || !receipt) {
    return NextResponse.json(
      { error: receiptErr?.message ?? "Failed to save receipt" },
      { status: 500 }
    );
  }

  // Save items
  if (parsed.items.length > 0) {
    const itemRows = parsed.items.map((item, idx) => ({
      receipt_id: receipt.id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      sort_order: idx,
    }));

    await db.from("receipt_items").insert(itemRows);
  }

  // Fetch back the full receipt with items
  const { data: full } = await db
    .from("receipt_scans")
    .select("*, receipt_items(*)")
    .eq("id", receipt.id)
    .single();

  return NextResponse.json(full);
}
