export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await loadClerkAuth();
  if (!auth.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const userId = await getEffectiveUserId({ userId: auth.userId });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();
  const { data: bill } = await db
    .from("payment_requests")
    .select("id, payer_member_id, amount, label, currency, status")
    .eq("id", id)
    .maybeSingle();

  if (!bill || bill.status !== "pending") {
    return NextResponse.json({ error: "Bill not available" }, { status: 400 });
  }

  const { data: payer } = await db.from("group_members").select("user_id").eq("id", bill.payer_member_id).maybeSingle();
  if (payer?.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db
    .from("payment_requests")
    .update({
      status: "settled_off_link",
      resolution_method: "add_to_tab",
      paid_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
