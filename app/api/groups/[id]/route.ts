export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getSuggestedSettlements } from "@/lib/split-balances";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import {
  merchantLabelFromSplitRow,
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

const BALANCE_EPS = 0.005;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const db = getSupabase();

    const allowed = await canAccessGroup(userId, id);
    if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: group, error: groupError } = await db.from("groups").select("*").eq("id", id).single();
    if (groupError || !group) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isOwner = group.owner_id === userId;
    const { invite_token, ...groupWithoutToken } = group as typeof group & { invite_token?: string };
    const maskedGroup = { ...groupWithoutToken, invite_token: isOwner ? invite_token : null };

    let { data: members } = await db
      .from("group_members")
      .select("id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username")
      .eq("group_id", id);

    const ownerId = group.owner_id as string;
    const ownerMember = (members ?? []).find((m) => m.user_id === ownerId && !m.email);
    if (ownerMember && ownerId) {
      try {
        const client = await clerkClient();
        const ownerUser = await client.users.getUser(ownerId);
        const ownerEmail = ownerUser?.primaryEmailAddress?.emailAddress ?? null;
        if (ownerEmail) {
          await db.from("group_members").update({ email: ownerEmail }).eq("id", ownerMember.id);
          members = (members ?? []).map((m) =>
            m.id === ownerMember.id ? { ...m, email: ownerEmail } : m
          );
        }
      } catch {
        // Ignore Clerk errors (e.g. no secret key in dev)
      }
    }

    const { data: splitsRaw } = await db
      .from("split_transactions")
      .select(`
      id, transaction_id, created_by, created_at, payer_member_id, amount, description,
      iso_currency_code,
      transactions(merchant_name, raw_name, amount, date)
    `)
      .eq("group_id", id)
      .order("created_at", { ascending: false });

    const seenTxIds = new Set<string>();
    const splits = (splitsRaw ?? []).filter((s) => {
      const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
      if (seenTxIds.has(k)) return false;
      seenTxIds.add(k);
      return true;
    });

    if (splits.length === 0) {
      return NextResponse.json({
        group: maskedGroup,
        members: members ?? [],
        activity: [],
        balances: (members ?? []).map((m) => ({
          memberId: m.id,
          currency: "USD",
          paid: 0,
          owed: 0,
          total: 0,
        })),
        suggestions: [],
        totalSpend: 0,
        totalSpendByCurrency: [],
      });
    }

    const { data: shares } = await db
      .from("split_shares")
      .select("split_transaction_id, member_id, amount")
      .in("split_transaction_id", splits.map((s) => s.id));

    const { data: settlements } = await db
      .from("settlements")
      .select("payer_member_id, receiver_member_id, amount, method, status, iso_currency_code")
      .eq("group_id", id)
      .eq("status", "completed");

    const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
    let txRows: { id: string; clerk_user_id: string }[] = [];
    if (txIds.length > 0) {
      const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
      txRows = data ?? [];
    }

    const txOwnerById = new Map((txRows ?? []).map((t) => [t.id, t.clerk_user_id]));
    const memberByUserId = new Map(
      (members ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m.id])
    );

    const splitCurrencyById = new Map(
      splits.map((s) => [
        s.id,
        normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
      ])
    );

    const paidRows: { member_id: string; amount: number; currency: string }[] = [];
    for (const s of splits) {
      const tid = s.transaction_id as string | null | undefined;
      const payerMemberId = (s as { payer_member_id?: string | null }).payer_member_id;
      const memberId =
        payerMemberId && (members ?? []).some((m) => m.id === payerMemberId)
          ? payerMemberId
          : (() => {
              const ownerId2 = tid ? txOwnerById.get(tid) : undefined;
              return ownerId2 ? memberByUserId.get(ownerId2) : null;
            })();
      if (memberId) {
        const amt = paidAmountFromSplitRow(
          s as { transactions?: unknown; amount?: number | string | null }
        );
        if (amt > 0) {
          paidRows.push({
            member_id: memberId,
            amount: amt,
            currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
          });
        }
      }
    }

    const owedBySplitMember = new Map<string, number>();
    for (const sh of shares ?? []) {
      const key = `${sh.split_transaction_id}:${sh.member_id}`;
      owedBySplitMember.set(key, (owedBySplitMember.get(key) ?? 0) + Number(sh.amount));
    }
    const owedRows = Array.from(owedBySplitMember.entries()).map(([key, amount]) => {
      const splitId = key.split(":")[0];
      return {
        member_id: key.split(":")[1],
        amount,
        currency: splitCurrencyById.get(splitId) ?? "USD",
      };
    });

    const paidSettlements = (settlements ?? []).map((s) => ({
      payer_member_id: s.payer_member_id,
      amount: Number(s.amount),
      currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
    }));
    const receivedSettlements = (settlements ?? []).map((s) => ({
      receiver_member_id: s.receiver_member_id,
      amount: Number(s.amount),
      currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
    }));

    const balancesByCurrency = computeBalancesByCurrency(
      paidRows,
      owedRows,
      paidSettlements,
      receivedSettlements
    );

    const balancesFlat: Array<{
      memberId: string;
      currency: string;
      paid: number;
      owed: number;
      total: number;
    }> = [];

    for (const [cur, balMap] of balancesByCurrency) {
      for (const b of balMap.values()) {
        if (Math.abs(b.total) < BALANCE_EPS) continue;
        balancesFlat.push({
          memberId: b.memberId,
          currency: cur,
          paid: b.paid,
          owed: b.owed,
          total: b.total,
        });
      }
    }
    balancesFlat.sort((a, b) => {
      const n = a.memberId.localeCompare(b.memberId);
      if (n !== 0) return n;
      return a.currency.localeCompare(b.currency);
    });

    const suggestions: Array<{
      currency: string;
      fromMemberId: string;
      toMemberId: string;
      amount: number;
    }> = [];
    for (const [cur, balMap] of balancesByCurrency) {
      const sug = getSuggestedSettlements(balMap);
      for (const s of sug) {
        suggestions.push({ currency: cur, ...s });
      }
    }

    const spendByCurrency = new Map<string, number>();
    for (const r of paidRows) {
      const c = normalizeSplitCurrency(r.currency);
      spendByCurrency.set(c, (spendByCurrency.get(c) ?? 0) + r.amount);
    }
    const totalSpendByCurrency = [...spendByCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    const totalSpend =
      totalSpendByCurrency.length === 1
        ? totalSpendByCurrency[0].amount
        : totalSpendByCurrency.length === 0
          ? 0
          : null;

    const memberMap = new Map((members ?? []).map((m) => [m.id, m]));

    const activity = splits.map((s) => {
      const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
      const totalShares = shareList.length;
      const payerMemberId = (s as { payer_member_id?: string | null }).payer_member_id;
      const payerMember = payerMemberId ? memberMap.get(payerMemberId) : null;
      const ownerId3 = s.transaction_id ? txOwnerById.get(s.transaction_id) : undefined;
      const ownerMember = ownerId3 ? Array.from(memberMap.values()).find((m) => m.user_id === ownerId3) : null;
      const paidByMember = payerMember ?? ownerMember;
      return {
        id: s.id,
        merchant: merchantLabelFromSplitRow(
          s as { transactions?: unknown; description?: string | null }
        ),
        amount: paidAmountFromSplitRow(
          s as { transactions?: unknown; amount?: number | string | null }
        ),
        currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
        paidBy: s.created_by,
        paidByDisplayName: paidByMember?.display_name ?? "Someone",
        splitCount: totalShares,
        createdAt: s.created_at,
      };
    });

    const archivedAt = (group as { archived_at?: string | null }).archived_at ?? null;

    return NextResponse.json({
      ...maskedGroup,
      group: maskedGroup,
      isOwner,
      archivedAt,
      members: members ?? [],
      activity,
      balances: balancesFlat,
      suggestions: suggestions.map((s) => ({
        ...s,
        fromMember: memberMap.get(s.fromMemberId),
        toMember: memberMap.get(s.toMemberId),
      })),
      totalSpend,
      totalSpendByCurrency,
    });
  } catch (err) {
    console.error("[groups/id]", err);
    return NextResponse.json({ error: "Failed to load group" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getSupabase();
  const { data: row, error: loadErr } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (loadErr || !row || row.owner_id !== userId) {
    return NextResponse.json({ error: "Only the group owner can archive or unarchive" }, { status: 403 });
  }

  let body: { archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.archived === true) {
    const archivedAt = new Date().toISOString();
    const { error: up } = await db.from("groups").update({ archived_at: archivedAt }).eq("id", id);
    if (up) return NextResponse.json({ error: up.message }, { status: 500 });
    return NextResponse.json({ ok: true, archivedAt });
  }
  if (body.archived === false) {
    const { error: up } = await db.from("groups").update({ archived_at: null }).eq("id", id);
    if (up) return NextResponse.json({ error: up.message }, { status: 500 });
    return NextResponse.json({ ok: true, archivedAt: null });
  }

  return NextResponse.json({ error: "Set archived to true or false" }, { status: 400 });
}
