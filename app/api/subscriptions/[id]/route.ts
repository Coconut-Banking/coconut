export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    const body = await _req.json().catch(() => ({}));
    const status = body?.status as string | undefined;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status && ["active", "cancelled", "paused", "dismissed"].includes(status)) updates.status = status;
    if (body?.dismissPriceChange === true) {
      updates.previous_amount = null;
      updates.price_change_amount = null;
      updates.price_change_detected_at = null;
    }
    const db = getSupabase();
    const { data, error } = await db
      .from("subscriptions")
      .update(updates)
      .eq("id", id)
      .eq("clerk_user_id", userId)
      .select("id, status")
      .single();
    if (error) {
      console.error("[subscriptions/id] update error:", error);
      return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    revalidateTag(CACHE_TAGS.transactions(userId), "max");
    return NextResponse.json(data);
  } catch (err) {
    console.error("[subscriptions/id] error:", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
