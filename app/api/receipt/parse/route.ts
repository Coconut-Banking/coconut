export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { parseReceiptImage } from "@/lib/receipt-ocr";
import { rateLimit } from "@/lib/rate-limit";

function detectImageFormat(buf: Buffer): string {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp";
  const ftypOffset = buf.indexOf("ftyp");
  if (ftypOffset >= 0 && ftypOffset <= 8) {
    const brand = buf.slice(ftypOffset + 4, ftypOffset + 8).toString("ascii");
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "heic";
  }
  return "unknown";
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`receipt-parse:${userId}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const formData = (await req.formData()) as unknown as FormData;
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "image file required" }, { status: 400 });
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are accepted" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawMime = file.type || "image/png";
  const detectedFormat = detectImageFormat(buffer);

  console.log("[receipt-parse] file.name:", file.name, "file.type:", rawMime, "size:", file.size, "detected:", detectedFormat);

  let finalBuffer: Buffer = buffer;
  let mimeType = rawMime;

  if (detectedFormat === "heic" || rawMime === "image/heic" || rawMime === "image/heif") {
    try {
      const sharp = (await import("sharp")).default;
      finalBuffer = Buffer.from(await sharp(buffer).jpeg({ quality: 90 }).toBuffer());
      mimeType = "image/jpeg";
      console.log("[receipt-parse] converted HEIC to JPEG, new size:", finalBuffer.length);
    } catch (convErr) {
      console.error("[receipt-parse] HEIC conversion failed:", convErr);
      return NextResponse.json(
        { error: "Unsupported image format (HEIC). Please use JPEG or PNG." },
        { status: 400 }
      );
    }
  } else {
    mimeType = detectedFormat === "jpeg" ? "image/jpeg"
      : detectedFormat === "png" ? "image/png"
      : detectedFormat === "gif" ? "image/gif"
      : detectedFormat === "webp" ? "image/webp"
      : rawMime;
  }

  const base64 = finalBuffer.toString("base64");

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
      .select("id, merchant_name, receipt_date, subtotal, tax, tip, other_fees, total, status, created_at")
      .single();

    if (receiptErr || !receipt) {
      console.error("Database save failed:", receiptErr);
      return NextResponse.json(
        { error: "Failed to save receipt" },
        { status: 500 }
      );
    }

    // Save items and get back inserted rows (avoids a separate SELECT round trip)
    let insertedItems: Array<{id: string; receipt_id: string; name: string; quantity: number | null; unit_price: number | null; total_price: number | null; sort_order: number}> = [];
    if (parsed.items.length > 0) {
      const itemRows = parsed.items.map((item, idx) => ({
        receipt_id: receipt.id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        sort_order: idx,
      }));

      const { data: itemsData } = await db.from("receipt_items").insert(itemRows).select("id, receipt_id, name, quantity, unit_price, total_price, sort_order");
      insertedItems = (itemsData ?? []) as typeof insertedItems;
    }

    // Return directly without an extra SELECT round trip
    return NextResponse.json({ ...receipt, receipt_items: insertedItems });
  } catch (error) {
    console.error("Error in receipt parse route:", error);
    return NextResponse.json(
      { error: "Failed to parse receipt" },
      { status: 500 }
    );
  }
}
