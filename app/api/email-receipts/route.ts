export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { EMAIL_RECEIPTS, GMAIL } from "@/lib/config";

function isExcludedReceipt(rawFrom: string | null, merchant: string | null): boolean {
  const from = (rawFrom ?? "").toLowerCase();
  const merch = (merchant ?? "").toLowerCase();
  return (
    GMAIL.EXCLUDED_SENDERS.some((d) => from.includes(d)) ||
    GMAIL.EXCLUDED_SENDERS.some((d) => merch.includes(d.replace(".com", "")))
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getSupabase();

    const { data: receipts, error } = await db
      .from("email_receipts")
      .select("*")
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

    return NextResponse.json({
      receipts: filtered,
      count: filtered.length,
    });
  } catch (e) {
    console.error("Error fetching receipts:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}