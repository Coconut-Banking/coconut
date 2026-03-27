export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import {
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

/** Ignore sub–half-cent noise when deciding “settled” vs outstanding (Splitwise-style lists). */
const BALANCE_EPS = 0.005;

type PersonAgg = { displayName: string; byCurrency: Map<string, number> };

function addPersonCurrency(
  personBalances: Map<string, PersonAgg>,
  key: string,
  displayName: string,
  currency: string,
  delta: number
) {
  const cur = normalizeSplitCurrency(currency);
  const d = Math.round(delta * 100) / 100;
  if (Math.abs(d) < BALANCE_EPS) return;
  const existing = personBalances.get(key) ?? { displayName, byCurrency: new Map() };
  existing.displayName = displayName;
  const next = (existing.byCurrency.get(cur) ?? 0) + d;
  existing.byCurrency.set(cur, Math.round(next * 100) / 100);
  personBalances.set(key, existing);
}

function friendRowFromAgg(key: string, v: PersonAgg) {
  const balances = [...v.byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .filter((b) => Math.abs(b.amount) >= BALANCE_EPS)
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const balance = balances.length === 1 ? balances[0].amount : balances.length === 0 ? 0 : null;
  return { key, displayName: v.displayName, balance, balances };
}

/**
 * GET /api/groups/summary
 * Returns all friends and groups the user can access, with per-currency balances.
 * ?unsettled=1 — only include friends/groups with non-zero net (Splitwise-style unsettled lists).
 * ?contacts=1 — alias for the default (all), kept for backward compat with older app builds.
 *
 * Balances are **per ISO currency** (`balances` / `myBalances`). Do not sum across currencies.
 * When more than one currency is outstanding, `balance` / `myBalance` / headline totals are `null`
 * and clients must use `totalsByCurrency` / per-friend `balances`.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  const ids = await getAccessibleGroupIds(userId);

  const unsettledOnly = req.nextUrl.searchParams.get("unsettled") === "1";

  if (ids.length === 0) {
    return NextResponse.json({
      groups: [],
      friends: [],
      totalOwedToMe: 0,
      totalIOwe: 0,
      netBalance: 0,
      totalsByCurrency: [],
      _debug: { userId, groupIds: ids },
    });
  }

  const { data: groupsRaw } = await db
    .from("groups")
    .select("id, name, owner_id, created_at, group_type, archived_at")
    .in("id", ids)
    .order("created_at", { ascending: false });

  const groups = (groupsRaw ?? []).filter((g) => !(g as { archived_at?: string | null }).archived_at);

  const groupIds = (groups ?? []).map((g) => g.id);

  const { data: members } = await db
    .from("group_members")
    .select("id, group_id, user_id, display_name, email")
    .in("group_id", groupIds);

  const { data: splits } = await db
    .from("split_transactions")
    .select(`
      id, group_id, transaction_id, created_by, created_at, payer_member_id, amount, description,
      iso_currency_code,
      transactions(amount)
    `)
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(25000);

  const splitIds = (splits ?? []).map((s) => s.id);

  let shares: { split_transaction_id: string; member_id: string; amount: number }[] = [];
  let txRows: { id: string; clerk_user_id: string }[] = [];

  if (splitIds.length > 0) {
    const { data: sharesData } = await db
      .from("split_shares")
      .select("split_transaction_id, member_id, amount")
      .in("split_transaction_id", splitIds);
    shares = sharesData ?? [];
  }

  const txIds = (splits ?? []).map((s) => s.transaction_id).filter(Boolean);
  if (txIds.length > 0) {
    const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
    txRows = data ?? [];
  }

  const { data: settlements } = await db
    .from("settlements")
    .select("group_id, payer_member_id, receiver_member_id, amount, iso_currency_code")
    .in("group_id", groupIds)
    .eq("status", "completed");

  const memberByGroup = new Map<string, { id: string; user_id: string | null; display_name: string; email: string | null }[]>();
  for (const m of members ?? []) {
    const list = memberByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, user_id: m.user_id, display_name: m.display_name, email: m.email ?? null });
    memberByGroup.set(m.group_id, list);
  }

  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));
  const splitByGroup = new Map<string, NonNullable<typeof splits>>();
  const seenByGroup = new Map<string, Set<string>>();
  for (const s of splits ?? []) {
    const seen = seenByGroup.get(s.group_id) ?? new Set();
    const dedupeKey = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    seenByGroup.set(s.group_id, seen);
    const list = splitByGroup.get(s.group_id) ?? [];
    list.push(s);
    splitByGroup.set(s.group_id, list);
  }

  const personBalances = new Map<string, PersonAgg>();

  const groupsWithBalance = (groups ?? []).map((g) => {
    const groupSplits = splitByGroup.get(g.id) ?? [];
    const groupMembers = memberByGroup.get(g.id) ?? [];
    const myMember = groupMembers.find((m) => m.user_id === userId);
    const memberByUserId = new Map(
      groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
    );

    if (groupSplits.length === 0) {
      const lastActivityAt = g.created_at;
      return {
        id: g.id,
        name: g.name,
        groupType: (g as { group_type?: string }).group_type ?? "other",
        memberCount: groupMembers.length,
        myBalance: 0 as number | null,
        myBalances: [] as { currency: string; amount: number }[],
        lastActivityAt,
      };
    }

    const splitCurrencyById = new Map(
      groupSplits.map((s) => [
        s.id,
        normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
      ])
    );

    const paidRows: { member_id: string; amount: number; currency: string }[] = [];
    for (const s of groupSplits) {
      const sWithPayer = s as { payer_member_id?: string | null };
      const payerMemberId = sWithPayer.payer_member_id;
      const memberId =
        payerMemberId && groupMembers.some((m) => m.id === payerMemberId)
          ? payerMemberId
          : (() => {
              const tid = s.transaction_id as string | null | undefined;
              const ownerId = tid ? txOwnerById.get(tid) : undefined;
              return ownerId ? memberByUserId.get(ownerId) : null;
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

    const groupShareIds = groupSplits.map((x) => x.id);
    const owedRows = shares
      .filter((sh) => groupShareIds.includes(sh.split_transaction_id))
      .map((s) => ({
        member_id: s.member_id,
        amount: Number(s.amount),
        currency: splitCurrencyById.get(s.split_transaction_id) ?? "USD",
      }));

    const groupSettlements = (settlements ?? []).filter((s) => s.group_id === g.id);
    const paidSettlements = groupSettlements.map((s) => ({
      payer_member_id: s.payer_member_id,
      amount: Number(s.amount),
      currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
    }));
    const receivedSettlements = groupSettlements.map((s) => ({
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

    const myBalances: { currency: string; amount: number }[] = [];
    if (myMember) {
      for (const [cur, balMap] of balancesByCurrency) {
        const t = balMap.get(myMember.id)?.total ?? 0;
        if (Math.abs(t) >= BALANCE_EPS) {
          myBalances.push({ currency: cur, amount: Math.round(t * 100) / 100 });
        }
      }
      myBalances.sort((a, b) => a.currency.localeCompare(b.currency));
    }
    const myBalance =
      myBalances.length === 1 ? myBalances[0].amount : myBalances.length === 0 ? 0 : null;

    for (const m of groupMembers) {
      if (m.user_id === userId) continue;
      const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
      for (const [cur, balMap] of balancesByCurrency) {
        const theirBalance = balMap.get(m.id)?.total ?? 0;
        const myBalanceWithThem = Math.round(-theirBalance * 100) / 100;
        addPersonCurrency(personBalances, key, m.display_name, cur, myBalanceWithThem);
      }
    }

    const lastSplit = groupSplits[0];
    const lastActivityAt = lastSplit?.created_at ?? g.created_at;

    return {
      id: g.id,
      name: g.name,
      groupType: (g as { group_type?: string }).group_type ?? "other",
      memberCount: groupMembers.length,
      myBalance,
      myBalances,
      lastActivityAt,
    };
  });

  {
    const allMembers = members ?? [];
    for (const m of allMembers) {
      if (m.user_id === userId) continue;
      const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
      if (!personBalances.has(key)) {
        personBalances.set(key, { displayName: m.display_name, byCurrency: new Map() });
      }
    }
  }

  let friends = Array.from(personBalances.entries())
    .map(([key, v]) => friendRowFromAgg(key, v))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (unsettledOnly) {
    friends = friends.filter((f) => f.balances.length > 0);
  }

  let groupsOut = groupsWithBalance;
  if (unsettledOnly) {
    groupsOut = groupsWithBalance.filter((g) => (g.myBalances?.length ?? 0) > 0);
  }

  const totalsMap = new Map<string, { owedToMe: number; iOwe: number }>();
  for (const f of friends) {
    for (const b of f.balances) {
      const t = totalsMap.get(b.currency) ?? { owedToMe: 0, iOwe: 0 };
      if (b.amount > BALANCE_EPS) t.owedToMe += b.amount;
      else if (b.amount < -BALANCE_EPS) t.iOwe += Math.abs(b.amount);
      totalsMap.set(b.currency, t);
    }
  }

  const totalsByCurrency = [...totalsMap.entries()]
    .map(([currency, v]) => ({
      currency,
      owedToMe: Math.round(v.owedToMe * 100) / 100,
      iOwe: Math.round(v.iOwe * 100) / 100,
      net: Math.round((v.owedToMe - v.iOwe) * 100) / 100,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  let totalOwedToMe: number | null;
  let totalIOwe: number | null;
  let netBalance: number | null;
  if (totalsByCurrency.length === 0) {
    totalOwedToMe = 0;
    totalIOwe = 0;
    netBalance = 0;
  } else if (totalsByCurrency.length === 1) {
    totalOwedToMe = totalsByCurrency[0].owedToMe;
    totalIOwe = totalsByCurrency[0].iOwe;
    netBalance = totalsByCurrency[0].net;
  } else {
    totalOwedToMe = null;
    totalIOwe = null;
    netBalance = null;
  }

  console.log("[summary] response", {
    groups: groupsOut.length,
    friends: friends.length,
    unsettledOnly,
    totalsByCurrency: totalsByCurrency.length,
  });

  return NextResponse.json({
    groups: groupsOut,
    friends,
    totalOwedToMe,
    totalIOwe,
    netBalance,
    totalsByCurrency,
  });
}
