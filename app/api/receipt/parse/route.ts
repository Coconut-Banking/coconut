import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { parseReceiptImage } from "@/lib/receipt-ocr";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = (await req.formData()) as unknown as FormData;
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "image file required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/png";

  // Parse with GPT-4o Vision
  let parsed;
  try {
    parsed = await parseReceiptImage(base64, mimeType);
  } catch (error) {
    console.error("OCR failed:", error);
    return NextResponse.json({ error: "Failed to parse receipt" }, { status: 500 });
  }

  const db = getSupabase();

  // Normalize date to YYYY-MM-DD for PostgreSQL (handles "8/9/2025", "2025-08-09", etc.)
  let receiptDate: string | null = null;
  if (parsed.date) {
    const d = new Date(parsed.date);
    if (!isNaN(d.getTime())) {
      receiptDate = d.toISOString().slice(0, 10);
    }
  }

  // Skip storing large images to avoid DB row size limits (~1MB)
  const imagePayload = base64.length < 800_000 ? `data:${mimeType};base64,${base64}` : null;

  try {
    // Save receipt scan
    const otherFees = Array.isArray(parsed.other_fees)
      ? parsed.other_fees
      : [];
    const { data: receipt, error: receiptErr } = await db
      .from("receipt_scans")
      .insert({
        clerk_user_id: userId,
        merchant_name: parsed.merchant_name ?? "Unknown",
        receipt_date: receiptDate,
        subtotal: parsed.subtotal,
        tax: parsed.tax,
        tip: parsed.tip,
        other_fees: otherFees,
        total: parsed.total,
        image_base64: imagePayload,
        status: "parsed",
      })
      .select("id")
      .single();

    if (receiptErr || !receipt) {
      console.error("Database save failed:", receiptErr);
      return NextResponse.json(
        { error: "Failed to save receipt" },
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
  } catch (error) {
    console.error("Error in receipt parse route:", error);
    return NextResponse.json(
      { error: "Failed to parse receipt" },
      { status: 500 }
    );
  }
}
