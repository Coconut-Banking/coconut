export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transactionId = request.nextUrl.searchParams.get("transactionId");
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId required" }, { status: 400 });
  }

  const db = getSupabase();
  const { data, error } = await db
    .from("email_receipts")
    .select("*")
    .eq("clerk_user_id", userId)
    .eq("transaction_id", transactionId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch receipt" }, { status: 500 });
  }

  return NextResponse.json({ receipt: data });
}
