export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params (independent)
  const [{ userId }, { id }] = await Promise.all([auth(), params]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getSupabase();

  const { data: split, error: splitError } = await db
    .from("split_transactions")
    .select("id, group_id, transaction_id")
    .eq("id", id)
    .single();

  if (splitError || !split) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await canAccessGroup(userId, split.group_id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let linkedTxClerkUserId: string | null = null;
  if (split.transaction_id) {
    const { data: tx } = await db
      .from("transactions")
      .select("clerk_user_id")
      .eq("id", split.transaction_id)
      .maybeSingle();
    linkedTxClerkUserId = (tx?.clerk_user_id as string | undefined) ?? null;
  }

  await db.from("split_transactions").delete().eq("id", id);
  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  if (linkedTxClerkUserId && linkedTxClerkUserId !== userId) {
    revalidateTag(CACHE_TAGS.splitTransactions(linkedTxClerkUserId), "max");
    revalidateTag(CACHE_TAGS.transactions(linkedTxClerkUserId), "max");
  }

  const { count } = await db
    .from("split_transactions")
    .select("id", { count: "exact", head: true })
    .eq("group_id", split.group_id);

  if (count === 0) {
    await db.from("settlements").delete().eq("group_id", split.group_id);
  }

  if (split.transaction_id) {
    await db.from("transactions").delete().eq("id", split.transaction_id);
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/split-transactions/:id
 * Edit an existing expense. Any group member can edit.
 * Body: { description?, amount?, payerMemberId?, notes?, category?, receipt_url?, shares?: [{ memberId, amount }] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params + body parse (independent)
  const [{ userId }, { id }, bodyRaw] = await Promise.all([
    auth(),
    params,
    req.json().catch(() => null),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (bodyRaw === null) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const body = bodyRaw as Record<string, unknown>;

  const db = getSupabase();

  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 500) || null : null;
  const newAmount =
    typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0
      ? body.amount
      : null;
  const payerMemberId = typeof body.payerMemberId === "string" ? body.payerMemberId : null;

  let pNotes: string | null = null;
  let pClearNotes = false;
  if ("notes" in body) {
    if (body.notes === null) pClearNotes = true;
    else if (typeof body.notes === "string") pNotes = body.notes.trim().slice(0, 2000);
    else return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }

  let pCategory: string | null = null;
  let pClearCategory = false;
  if ("category" in body) {
    if (body.category === null) pClearCategory = true;
    else if (typeof body.category === "string") pCategory = body.category.trim().slice(0, 200);
    else return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  let pReceiptUrl: string | null = null;
  let pClearReceiptUrl = false;
  if ("receipt_url" in body) {
    if (body.receipt_url === null) pClearReceiptUrl = true;
    else if (typeof body.receipt_url === "string") pReceiptUrl = body.receipt_url.trim().slice(0, 2048);
    else return NextResponse.json({ error: "Invalid receipt_url" }, { status: 400 });
  }

  const sharesForRpc = Array.isArray(body.shares)
    ? (body.shares as Array<{ memberId: string; amount: number }>)
        .filter((s) => Number(s.amount) > 0)
        .map((s) => ({
          memberId: s.memberId,
          amount: Math.round(Number(s.amount) * 100) / 100,
        }))
    : null;

  const { data: rpcData, error: rpcErr } = await db.rpc("update_split_transaction", {
    p_clerk_user_id: userId,
    p_split_id: id,
    p_description: description,
    p_amount: newAmount,
    p_payer_member_id: payerMemberId,
    p_notes: pNotes,
    p_category: pCategory,
    p_receipt_url: pReceiptUrl,
    p_clear_notes: pClearNotes,
    p_clear_category: pClearCategory,
    p_clear_receipt_url: pClearReceiptUrl,
    p_shares: sharesForRpc,
  });

  if (rpcErr) {
    console.error("[split-transactions] update_split_transaction RPC error:", rpcErr.message);
    return NextResponse.json(
      { error: rpcErr.message ?? "Failed to update expense" },
      { status: 500 }
    );
  }

  const result = rpcData as { ok?: boolean; error?: string; id?: string; groupId?: string } | null;
  if (result?.error) {
    const msg = result.error;
    const status =
      msg === "Not found"
        ? 404
        : msg === "Invalid member IDs in shares" || msg === "Payer not in group"
          ? 400
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
  if (!result?.ok || !result.groupId) {
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  return NextResponse.json({ ok: true, id });
}
