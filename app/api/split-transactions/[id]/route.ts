export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { canAccessGroup } from "@/lib/group-access";
import { toCents } from "@/lib/expense-shares";

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

  const { data: split, error: splitErr } = await db
    .from("split_transactions")
    .select("id, group_id, transaction_id, payer_member_id")
    .eq("id", id)
    .single();

  if (splitErr || !split) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await canAccessGroup(userId, split.group_id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: members } = await db
    .from("group_members")
    .select("id, user_id, display_name")
    .eq("group_id", split.group_id);

  const memberIds = new Set((members ?? []).map((m) => m.id));

  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;
  const newAmount = typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0 ? body.amount : null;
  const payerMemberId = typeof body.payerMemberId === "string" && memberIds.has(body.payerMemberId)
    ? body.payerMemberId
    : null;
  const customShares = Array.isArray(body.shares) ? body.shares as Array<{ memberId: string; amount: number }> : null;

  if (customShares) {
    const invalid = customShares.filter((s) => !memberIds.has(s.memberId));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "Invalid member IDs in shares" }, { status: 400 });
    }
    const effectiveAmount = newAmount ?? (await getExistingAmount(db, split.transaction_id, split.id));
    if (effectiveAmount) {
      const sumCents = customShares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
      if (Math.abs(sumCents - toCents(effectiveAmount)) > 1) {
        return NextResponse.json({ error: `Shares must sum to $${effectiveAmount.toFixed(2)}` }, { status: 400 });
      }
    }
  }

  if (description && split.transaction_id) {
    await db
      .from("transactions")
      .update({ merchant_name: description, raw_name: description })
      .eq("id", split.transaction_id);
  }

  if (newAmount && split.transaction_id) {
    await db
      .from("transactions")
      .update({ amount: -newAmount })
      .eq("id", split.transaction_id);
  }

  const splitUpdates: Record<string, string | number | null> = {};

  if (typeof body.description === "string" && !split.transaction_id) {
    splitUpdates.description = description;
  }
  if (newAmount && !split.transaction_id) {
    splitUpdates.amount = newAmount;
  }
  if (payerMemberId) {
    splitUpdates.payer_member_id = payerMemberId;
  }
  if ("notes" in body) {
    if (body.notes === null) splitUpdates.notes = null;
    else if (typeof body.notes === "string") splitUpdates.notes = body.notes.trim().slice(0, 2000);
    else return NextResponse.json({ error: "Invalid notes" }, { status: 400 });
  }
  if ("category" in body) {
    if (body.category === null) splitUpdates.category = null;
    else if (typeof body.category === "string") splitUpdates.category = body.category.trim().slice(0, 200);
    else return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if ("receipt_url" in body) {
    if (body.receipt_url === null) splitUpdates.receipt_url = null;
    else if (typeof body.receipt_url === "string") splitUpdates.receipt_url = body.receipt_url.trim().slice(0, 2048);
    else return NextResponse.json({ error: "Invalid receipt_url" }, { status: 400 });
  }

  if (Object.keys(splitUpdates).length > 0) {
    await db.from("split_transactions").update(splitUpdates).eq("id", id);
  }

  if (customShares && customShares.length > 0) {
    await db.from("split_shares").delete().eq("split_transaction_id", id);
    const { error: sharesErr } = await db.from("split_shares").insert(
      customShares
        .filter((s) => Number(s.amount) > 0)
        .map((s) => ({
          split_transaction_id: id,
          member_id: s.memberId,
          amount: Math.round(Number(s.amount) * 100) / 100,
        }))
    );
    if (sharesErr) {
      return NextResponse.json({ error: sharesErr.message ?? "Failed to update shares" }, { status: 500 });
    }
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  return NextResponse.json({ ok: true, id });
}

async function getExistingAmount(
  db: ReturnType<typeof getSupabase>,
  txId: string | null,
  splitId: string
): Promise<number | null> {
  if (txId) {
    const { data } = await db.from("transactions").select("amount").eq("id", txId).maybeSingle();
    return data ? Math.abs(Number(data.amount)) : null;
  }
  const { data } = await db.from("split_transactions").select("amount").eq("id", splitId).maybeSingle();
  return data?.amount != null ? Math.abs(Number(data.amount)) : null;
}
