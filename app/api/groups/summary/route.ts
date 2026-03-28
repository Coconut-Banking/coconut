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
 *
 * Default: smart filter — friends are shown if they have a non-zero balance OR are in
 * a group that has any unsettled balance. Groups are shown if they have any unsettled balance.
 * ?contacts=1 — returns ALL friends/groups (incl. settled), for management/debug.
 * ?unsettled=1 — strict: only friends/groups with non-zero net (legacy).
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
  const showAll = req.nextUrl.searchParams.get("contacts") === "1";

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

  let groupsRaw: { id: string; name: string; owner_id: string; created_at: string; group_type?: string; source?: string | null; archived_at?: string | null }[] | null;
  {
    const res = await db
      .from("groups")
      .select("id, name, owner_id, created_at, group_type, source, archived_at")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (res.error?.code === "42703") {
      const fallback = await db
        .from("groups")
        .select("id, name, owner_id, created_at, group_type, source")
        .in("id", ids)
        .order("created_at", { ascending: false });
      groupsRaw = fallback.data;
    } else {
      groupsRaw = res.data;
    }
  }

  const groups = (groupsRaw ?? []).filter((g) => !g.archived_at);

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

    // Compute correct PAIRWISE balances between me and each other member.
    // For each expense: if I paid, they owe me their share; if they paid, I owe them my share.
    // (Using group-level totals would be wrong for 3+ person groups.)
    if (myMember) {
      const sharesByTx = new Map<string, Map<string, number>>();
      for (const sh of shares.filter((s) => groupShareIds.includes(s.split_transaction_id))) {
        let txMap = sharesByTx.get(sh.split_transaction_id);
        if (!txMap) { txMap = new Map(); sharesByTx.set(sh.split_transaction_id, txMap); }
        txMap.set(sh.member_id, Number(sh.amount));
      }

      const payerBySplit = new Map<string, string>();
      for (const s of groupSplits) {
        const sWithPayer = s as { payer_member_id?: string | null };
        const pid = sWithPayer.payer_member_id && groupMembers.some((m) => m.id === sWithPayer.payer_member_id)
          ? sWithPayer.payer_member_id
          : (() => { const tid = s.transaction_id as string | null | undefined; const oid = tid ? txOwnerById.get(tid) : undefined; return oid ? memberByUserId.get(oid) ?? null : null; })();
        if (pid) payerBySplit.set(s.id, pid);
      }

      for (const m of groupMembers) {
        if (m.user_id === userId) continue;
        const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;

        for (const s of groupSplits) {
          const cur = splitCurrencyById.get(s.id) ?? "USD";
          const txShares = sharesByTx.get(s.id);
          if (!txShares) continue;
          const payerId = payerBySplit.get(s.id);
          if (!payerId) continue;

          if (payerId === myMember.id) {
            const theirShare = txShares.get(m.id) ?? 0;
            if (theirShare > 0) addPersonCurrency(personBalances, key, m.display_name, cur, theirShare);
          } else if (payerId === m.id) {
            const myShare = txShares.get(myMember.id) ?? 0;
            if (myShare > 0) addPersonCurrency(personBalances, key, m.display_name, cur, -myShare);
          }
        }

        for (const st of groupSettlements) {
          const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
          const amt = Number(st.amount);
          if (st.payer_member_id === myMember.id && st.receiver_member_id === m.id) {
            addPersonCurrency(personBalances, key, m.display_name, cur, -amt);
          } else if (st.payer_member_id === m.id && st.receiver_member_id === myMember.id) {
            addPersonCurrency(personBalances, key, m.display_name, cur, amt);
          }
        }
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

  // Try to use cached Splitwise friend balances (authoritative) instead of recalculated ones.
  // Splitwise's balance engine handles multi-payer, debt simplification, etc. correctly.
  {
    const tokenRes = await db
      .from("splitwise_tokens")
      .select("cached_friend_balances")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    // Gracefully handle missing column (pre-migration)
    const tokenRow = tokenRes.error?.code === "PGRST204" ? null : tokenRes.data;

    type CachedFriend = {
      id: number;
      first_name: string;
      last_name: string;
      email: string | null;
      balance: { currency_code: string; amount: string }[];
    };
    const cached: CachedFriend[] | null =
      (tokenRow as Record<string, unknown> | null)?.cached_friend_balances as CachedFriend[] | null;

    if (cached && Array.isArray(cached) && cached.length > 0) {
      // Build a set of emails belonging to Splitwise-imported group members
      const swGroupIds = new Set(
        (groups ?? [])
          .filter((g) => {
            const row = g as Record<string, unknown>;
            return row.source === "splitwise";
          })
          .map((g) => g.id)
      );
      // If we can't detect source, treat ALL imported groups as potentially splitwise
      // and just overlay cached balances by email match.
      const memberEmailToKey = new Map<string, { key: string; displayName: string }>();
      for (const m of members ?? []) {
        if (m.user_id === userId || !m.email) continue;
        const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
        const email = m.email.toLowerCase().trim();
        if (!memberEmailToKey.has(email)) {
          memberEmailToKey.set(email, { key, displayName: m.display_name });
        }
      }

      // Build set of cached emails for quick lookup
      const cachedEmailSet = new Set(
        cached.map((f) => (f.email ?? "").toLowerCase().trim()).filter(Boolean)
      );

      // Replace personBalances for cached Splitwise friends
      for (const cf of cached) {
        const email = (cf.email ?? "").toLowerCase().trim();
        const match = memberEmailToKey.get(email);
        if (!match) continue;
        // Splitwise and Coconut use the same sign convention:
        //   positive = they owe you, negative = you owe them
        const newByCurrency = new Map<string, number>();
        for (const b of cf.balance ?? []) {
          const amt = parseFloat(b.amount);
          if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
          const cur = normalizeSplitCurrency(b.currency_code);
          newByCurrency.set(cur, Math.round(amt * 100) / 100);
        }
        personBalances.set(match.key, { displayName: match.displayName, byCurrency: newByCurrency });
      }

      // For members ONLY in Splitwise groups who are NOT in the cache,
      // their Splitwise balance is $0 — zero out the bad recalculated value.
      for (const m of members ?? []) {
        if (m.user_id === userId || !m.email) continue;
        const email = m.email.toLowerCase().trim();
        if (cachedEmailSet.has(email)) continue; // already handled above
        // Check if this member ONLY appears in Splitwise groups
        const memberGroups = (members ?? [])
          .filter((mm) => mm.email === m.email && mm.user_id !== userId)
          .map((mm) => mm.group_id);
        const allSw = memberGroups.every((gid) => swGroupIds.has(gid));
        if (allSw) {
          const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
          personBalances.set(key, { displayName: m.display_name, byCurrency: new Map() });
        }
      }
    }
  }

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

  let groupsOut = groupsWithBalance;

  if (showAll) {
    // Return everything (incl. settled) — no filtering.
  } else if (unsettledOnly) {
    friends = friends.filter((f) => f.balances.length > 0);
    groupsOut = groupsWithBalance.filter((g) => (g.myBalances?.length ?? 0) > 0);
  } else {
    // Smart filter: show friends with non-zero balance OR in an active group.
    const activeGroupIds = new Set(
      groupsWithBalance
        .filter((g) => (g.myBalances?.length ?? 0) > 0)
        .map((g) => g.id)
    );

    const memberGroupsByKey = new Map<string, Set<string>>();
    for (const m of members ?? []) {
      if (m.user_id === userId) continue;
      const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
      const set = memberGroupsByKey.get(key) ?? new Set();
      set.add(m.group_id);
      memberGroupsByKey.set(key, set);
    }

    friends = friends.filter((f) => {
      if (f.balances.length > 0) return true;
      const friendGroups = memberGroupsByKey.get(f.key);
      if (!friendGroups) return false;
      for (const gid of friendGroups) {
        if (activeGroupIds.has(gid)) return true;
      }
      return false;
    });

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
