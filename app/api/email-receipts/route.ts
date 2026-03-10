import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { EMAIL_RECEIPTS } from "@/lib/config";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getSupabase();

    // Fetch email receipts from the database
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

    return NextResponse.json({
      receipts: receipts || [],
      count: receipts?.length || 0
    });
  } catch (e) {
    console.error("Error fetching receipts:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}