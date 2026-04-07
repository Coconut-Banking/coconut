export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getClerkUserPhotos } from "@/lib/clerk-user-lookup";

let _hasExtendedCols: boolean | null = null;

/**
 * GET /api/groups/transaction?id=<split_transaction_id>
 * Returns full detail for a single split transaction including shares and member names.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getSupabaseAdmin();

  type TxRow = { id: string; group_id: string; description: string; amount: number; date: string; iso_currency_code: string | null; payer_member_id: string; created_at: string; source: string | null; external_id: string | null; notes?: string | null; category?: string | null; receipt_url?: string | null };
  const selectCols = _hasExtendedCols !== false
    ? `id, group_id, description, amount, date, iso_currency_code, payer_member_id, created_at, source, external_id, notes, category, receipt_url`
    : `id, group_id, description, amount, date, iso_currency_code, payer_member_id, created_at, source, external_id`;
  const { data: tx, error: txErr } = await db
    .from("split_transactions")
    .select(selectCols)
    .eq("id", id)
    .maybeSingle() as unknown as { data: TxRow | null; error: { code?: string } | null };

  if (txErr?.code === "42703" && _hasExtendedCols !== false) {
    _hasExtendedCols = false;
    const { data: txFallback } = await db
      .from("split_transactions")
      .select(`id, group_id, description, amount, date, iso_currency_code, payer_member_id, created_at, source, external_id`)
      .eq("id", id)
      .maybeSingle();
    if (!txFallback) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const accessibleIdsFallback = await getAccessibleGroupIds(userId);
    if (!accessibleIdsFallback.includes(txFallback.group_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return buildResponse(db, userId, txFallback, null, null, null);
  }
  if (!txErr) _hasExtendedCols = true;

  if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const accessibleIds = await getAccessibleGroupIds(userId);
  if (!accessibleIds.includes(tx.group_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return buildResponse(
    db,
    userId,
    tx,
    (tx as Record<string, unknown>).notes as string | null ?? null,
    (tx as Record<string, unknown>).category as string | null ?? null,
    (tx as Record<string, unknown>).receipt_url as string | null ?? null,
  );
}

async function buildResponse(
  db: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  tx: {
    id: string;
    group_id: string;
    description: string;
    amount: number | null;
    date: string | null;
    iso_currency_code: string | null;
    payer_member_id: string | null;
    created_at: string;
    source: string | null;
    external_id: string | null;
  },
  notes: string | null,
  category: string | null,
  receiptUrl: string | null,
) {
  const { data: group } = await db
    .from("groups")
    .select("id, name")
    .eq("id", tx.group_id)
    .maybeSingle();

  const { data: members } = await db
    .from("group_members")
    .select("id, display_name, email, user_id")
    .eq("group_id", tx.group_id);

  const { data: shares } = await db
    .from("split_shares")
    .select("member_id, amount")
    .eq("split_transaction_id", tx.id);

  const memberMap = new Map((members ?? []).map((m) => [m.id, m]));
  const memberUserIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
  const photoMap = await getClerkUserPhotos(memberUserIds);
  const currency = normalizeSplitCurrency(tx.iso_currency_code);

  const payer = tx.payer_member_id ? memberMap.get(tx.payer_member_id) : null;

  const shareRows = (shares ?? []).map((s) => {
    const member = memberMap.get(s.member_id);
    return {
      memberId: s.member_id,
      displayName: member?.display_name ?? "Someone",
      isMe: member?.user_id === userId,
      amount: Number(s.amount),
      image_url: (member?.user_id && photoMap.get(member.user_id)) || null,
    };
  }).sort((a, b) => b.amount - a.amount);

  const sharesTotal = shareRows.reduce((sum, s) => sum + s.amount, 0);
  const effectiveAmount = (tx.amount && tx.amount > 0) ? tx.amount : (sharesTotal > 0 ? Math.round(sharesTotal * 100) / 100 : 0);
  const effectiveDescription = tx.description || group?.name || "Expense";

  return NextResponse.json({
    id: tx.id,
    description: effectiveDescription,
    amount: effectiveAmount,
    currency,
    date: tx.date,
    createdAt: tx.created_at,
    groupName: group?.name ?? null,
    groupId: tx.group_id,
    paidBy: payer
      ? { memberId: payer.id, displayName: payer.display_name, isMe: payer.user_id === userId, image_url: (payer.user_id && photoMap.get(payer.user_id)) || null }
      : null,
    shares: shareRows,
    notes,
    category,
    receiptUrl,
    splitwiseUrl: null,
  });
}
