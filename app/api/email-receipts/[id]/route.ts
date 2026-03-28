export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data, error } = await db
    .from("email_receipts")
    .select("id, merchant, amount, subtotal, tax, line_items, merchant_details, merchant_type")
    .eq("id", id)
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[email-receipts] GET by id error:", error);
    return NextResponse.json({ error: "Failed to fetch receipt" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const details = (data.merchant_details ?? {}) as Record<string, unknown>;
  const lineItems = (data.line_items ?? []) as Array<Record<string, unknown>>;

  // Build extras from merchant_details top-level fee fields
  const extras: Array<{ name: string; amount: number }> = [];
  const feeKeys: Record<string, string> = {
    tip: "Tip",
    delivery_fee: "Delivery fee",
    booking_fee: "Booking fee",
    service_fee: "Service fee",
    surge: "Surge",
    tolls: "Tolls",
  };
  for (const [key, label] of Object.entries(feeKeys)) {
    if (key === "tip") continue; // tip is a top-level field, not in extras
    const val = Number(details[key]);
    if (val > 0) extras.push({ name: label, amount: val });
  }

  return NextResponse.json({
    id: data.id,
    merchant_name: data.merchant ?? "Unknown",
    merchant_type: (data as Record<string, unknown>).merchant_type ?? null,
    merchant_details: data.merchant_details ?? null,
    subtotal: Number(data.subtotal) || 0,
    tax: Number(data.tax) || 0,
    tip: Number(details.tip) || 0,
    total: Number(data.amount) || 0,
    extras,
    receipt_items: lineItems.map((item, index) => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || Number(item.price) || 0;
      return {
        id: `${data.id}-${index}`,
        name: String(item.name || "Item"),
        quantity,
        unit_price: unitPrice,
        total_price: Number(item.total) || unitPrice * quantity,
        sort_order: index,
      };
    }),
  });
}
