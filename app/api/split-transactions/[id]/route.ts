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
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  const { data: split, error: splitError } = await db
    .from("split_transactions")
    .select("id, group_id, transaction_id")
    .eq("id", id)
    .single();

  if (splitError || !split) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await canAccessGroup(userId, split.group_id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.from("split_transactions").delete().eq("id", id);
  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  if (split.transaction_id) {
    const { data: tx } = await db
      .from("transactions")
      .select("clerk_user_id")
      .eq("id", split.transaction_id)
      .maybeSingle();
    if (tx?.clerk_user_id && tx.clerk_user_id !== userId) {
      revalidateTag(CACHE_TAGS.splitTransactions(tx.clerk_user_id as string), "max");
      revalidateTag(CACHE_TAGS.transactions(tx.clerk_user_id as string), "max");
    }
  }

  const { count } = await db
    .from("split_transactions")
    .select("id", { count: "exact", head: true })
    .eq("group_id", split.group_id);

  if (count === 0) {
    await db.from("settlements").delete().eq("group_id", split.group_id);
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/split-transactions/:id
 * Edit an existing expense. Any group member can edit.
 * Body: { description?, amount?, payerMemberId?, shares?: [{ memberId, amount }] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

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
    const effectiveAmount = newAmount ?? (await getExistingAmount(db, split.transaction_id));
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

  if (payerMemberId) {
    await db
      .from("split_transactions")
      .update({ payer_member_id: payerMemberId })
      .eq("id", id);
  }

  if (customShares && customShares.length > 0) {
    await db.from("split_shares").delete().eq("split_transaction_id", id);
    await db.from("split_shares").insert(
      customShares
        .filter((s) => Number(s.amount) > 0)
        .map((s) => ({
          split_transaction_id: id,
          member_id: s.memberId,
          amount: Math.round(Number(s.amount) * 100) / 100,
        }))
    );
  }

  revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");

  return NextResponse.json({ ok: true, id });
}

async function getExistingAmount(
  db: ReturnType<typeof getSupabase>,
  txId: string | null
): Promise<number | null> {
  if (!txId) return null;
  const { data } = await db.from("transactions").select("amount").eq("id", txId).maybeSingle();
  return data ? Math.abs(Number(data.amount)) : null;
}
