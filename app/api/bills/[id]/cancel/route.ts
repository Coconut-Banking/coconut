export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { loadClerkAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await loadClerkAuth();
  if (!auth.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const userId = await getEffectiveUserId({ userId: auth.userId });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();
  const { data: bill } = await db.from("payment_requests").select("receiver_member_id, status").eq("id", id).maybeSingle();
  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: receiver } = await db.from("group_members").select("user_id").eq("id", bill.receiver_member_id).maybeSingle();
  if (receiver?.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.from("payment_requests").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  return NextResponse.json({ ok: true });
}
