export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSuggestedSettlements } from "@/lib/split-balances";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import {
  merchantLabelFromSplitRow,
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

const BALANCE_EPS = 0.005;

/**
 * GET /api/groups/person?key=xxx
 * Returns person detail: balance, transactions across all shared groups, settlement info.
 * Key = user_id | email | groupId-memberId (for deduping)
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  try {
    const db = getSupabase();
    const ids = await getAccessibleGroupIds(userId);

    if (ids.length === 0) {
      return NextResponse.json({
        displayName: null,
        balance: 0,
        currencyBalances: [],
        activity: [],
        email: null,
        settlements: [],
      });
    }

    const { data: groups } = await db.from("groups").select("id, name, owner_id").in("id", ids);

    const { data: members } = await db
      .from("group_members")
      .select("id, group_id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username")
      .in("group_id", ids);

    const personMembers = (members ?? []).filter((m) => {
      if (m.user_id === userId) return false;
      if (m.user_id && m.user_id === key) return true;
      if (m.email && m.email === key) return true;
      if (`${m.group_id}-${m.id}` === key) return true;
      return false;
    });

    if (personMembers.length === 0) {
      return NextResponse.json(
        {
          displayName: null,
          balance: 0,
          currencyBalances: [],
          activity: [],
          email: null,
          settlements: [],
          sharedGroupIds: [],
          sharedGroups: [],
        },
        { status: 404 }
      );
    }

    const displayName = personMembers[0].display_name;
    const email = personMembers[0].email ?? null;
    const sharedGroupIds = [...new Set(personMembers.map((m) => m.group_id))];
    const personMemberIds = new Set(personMembers.map((m) => m.id));

    const p2pHandles = {
      venmo_username: personMembers.find((m) => m.venmo_username)?.venmo_username ?? null,
      cashapp_cashtag: personMembers.find((m) => m.cashapp_cashtag)?.cashapp_cashtag ?? null,
      paypal_username: personMembers.find((m) => m.paypal_username)?.paypal_username ?? null,
    };

    const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name as string]));
    const memberCountByGroup = new Map<string, number>();
    for (const m of members ?? []) {
      memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
    }
    const sharedGroups = sharedGroupIds
      .map((id) => ({
        id,
        name: groupNameById.get(id) ?? "Group",
        memberCount: memberCountByGroup.get(id) ?? 0,
      }))
      .sort((a, b) => a.memberCount - b.memberCount);

    const { data: splitsRaw } = await db
      .from("split_transactions")
      .select(`
      id, group_id, transaction_id, created_by, created_at, payer_member_id, amount, description,
      iso_currency_code, receipt_url,
      transactions(merchant_name, raw_name, amount, date)
    `)
      .in("group_id", sharedGroupIds)
      .order("created_at", { ascending: false })
      .limit(500);

    const seenByGroup = new Map<string, Set<string>>();
    const splits = (splitsRaw ?? []).filter((s) => {
      const seen = seenByGroup.get(s.group_id) ?? new Set();
      const dedupeKey = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      seenByGroup.set(s.group_id, seen);
      return true;
    });

    if (splits.length === 0) {
      return NextResponse.json({
        displayName,
        balance: 0,
        currencyBalances: [],
        activity: [],
        email,
        key,
        settlements: [],
        sharedGroupIds,
        sharedGroups,
        p2pHandles,
      });
    }

    const { data: shares } = await db
      .from("split_shares")
      .select("split_transaction_id, member_id, amount")
      .in("split_transaction_id", splits.map((s) => s.id));

    const { data: settlements } = await db
      .from("settlements")
      .select("group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method")
      .in("group_id", sharedGroupIds)
      .eq("status", "completed");

    const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
    let txRows: { id: string; clerk_user_id: string }[] = [];
    if (txIds.length > 0) {
      const { data } = await db.from("transactions").select("id, clerk_user_id").in("id", txIds);
      txRows = data ?? [];
    }

    const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

    const byCurrency = new Map<string, number>();
    const personSettlements: Array<{
      groupId: string;
      fromMemberId: string;
      toMemberId: string;
      amount: number;
      currency: string;
    }> = [];

    const activity: Array<{
      id: string;
      merchant: string;
      amount: number;
      currency: string;
      groupName: string;
      paidByMe: boolean;
      paidByThem: boolean;
      myShare: number;
      theirShare: number;
      effectOnBalance: number;
      createdAt: string;
      receiptUrl: string | null;
    }> = [];

    for (const groupId of sharedGroupIds) {
      const groupSplits = splits.filter((s) => s.group_id === groupId);
      const groupMembers = (members ?? []).filter((m) => m.group_id === groupId);
      const myMember = groupMembers.find((m) => m.user_id === userId);
      const theirMember = groupMembers.find((m) => personMemberIds.has(m.id));
      if (!myMember || !theirMember) continue;

      const memberByUserId = new Map(
        groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
      );

      const splitCurrencyById = new Map(
        groupSplits.map((s) => [
          s.id,
          normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
        ])
      );

      const paidRows: { member_id: string; amount: number; currency: string }[] = [];
      for (const s of groupSplits) {
        const payerMemberId = (s as { payer_member_id?: string | null }).payer_member_id;
        const memberId =
          payerMemberId && groupMembers.some((m) => m.id === payerMemberId)
            ? payerMemberId
            : (() => {
                const ownerId = txOwnerById.get(s.transaction_id);
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
      const owedRows = (shares ?? [])
        .filter((sh) => groupShareIds.includes(sh.split_transaction_id))
        .map((s) => ({
          member_id: s.member_id,
          amount: Number(s.amount),
          currency: splitCurrencyById.get(s.split_transaction_id) ?? "USD",
        }));

      const groupSettlements = (settlements ?? []).filter((s) => s.group_id === groupId);
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

      for (const [cur, balMap] of balancesByCurrency) {
        const theirBalance = balMap.get(theirMember.id)?.total ?? 0;
        const myBalanceWithThem = Math.round(-theirBalance * 100) / 100;
        if (Math.abs(myBalanceWithThem) < BALANCE_EPS) continue;
        const prev = byCurrency.get(cur) ?? 0;
        byCurrency.set(cur, Math.round((prev + myBalanceWithThem) * 100) / 100);
      }

      const suggestions = (() => {
        const out: Array<{ currency: string; fromMemberId: string; toMemberId: string; amount: number }> = [];
        for (const [cur, balMap] of balancesByCurrency) {
          for (const s of getSuggestedSettlements(balMap)) {
            out.push({ currency: cur, ...s });
          }
        }
        return out;
      })();

      for (const s of suggestions) {
        const involvesMe = s.fromMemberId === myMember.id || s.toMemberId === myMember.id;
        const involvesThem = s.fromMemberId === theirMember.id || s.toMemberId === theirMember.id;
        if (involvesMe && involvesThem) {
          personSettlements.push({
            groupId,
            fromMemberId: s.fromMemberId,
            toMemberId: s.toMemberId,
            amount: s.amount,
            currency: s.currency,
          });
        }
      }

      for (const s of groupSplits) {
        const shareList = (shares ?? []).filter((sh) => sh.split_transaction_id === s.id);
        const txAmount = paidAmountFromSplitRow(
          s as { transactions?: unknown; amount?: number | string | null }
        );
        const cur = normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code);
        const explicitPayer = (s as { payer_member_id?: string | null }).payer_member_id;
        const payerMemberId =
          explicitPayer && groupMembers.some((m) => m.id === explicitPayer)
            ? explicitPayer
            : (() => {
                const ownerId = txOwnerById.get(s.transaction_id);
                return ownerId ? memberByUserId.get(ownerId) : null;
              })();

        const paidByMe = payerMemberId === myMember.id;
        const paidByThem = payerMemberId === theirMember.id;
        const myShareRow = shareList.find((sh) => sh.member_id === myMember.id);
        const theirShareRow = shareList.find((sh) => sh.member_id === theirMember.id);
        const myShare = myShareRow ? Number(myShareRow.amount) : 0;
        const theirShare = theirShareRow ? Number(theirShareRow.amount) : 0;

        let effectOnBalance = 0;
        if (paidByMe && theirShare > 0) effectOnBalance = theirShare;
        else if (paidByThem && myShare > 0) effectOnBalance = -myShare;

        activity.push({
          id: s.id,
          merchant: merchantLabelFromSplitRow(
            s as { transactions?: unknown; description?: string | null }
          ),
          amount: txAmount,
          currency: cur,
          groupName: groupNameById.get(groupId) ?? "",
          paidByMe,
          paidByThem,
          myShare,
          theirShare,
          effectOnBalance,
          createdAt: s.created_at,
          receiptUrl: (s as { receipt_url?: string | null }).receipt_url ?? null,
        });
      }
    }

    activity.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Try cached Splitwise friend balance (authoritative) for the headline
    let currencyBalances: { currency: string; amount: number }[] = [];
    try {
      const { data: tokenRow } = await db
        .from("splitwise_tokens")
        .select("cached_friend_balances")
        .eq("clerk_user_id", userId)
        .maybeSingle();

      type CachedFriend = {
        email: string | null;
        balance: { currency_code: string; amount: string }[];
      };
      const cached: CachedFriend[] | null =
        (tokenRow as Record<string, unknown> | null)?.cached_friend_balances as CachedFriend[] | null;

      if (cached && Array.isArray(cached) && email) {
        const match = cached.find(
          (f) => (f.email ?? "").toLowerCase().trim() === email.toLowerCase().trim()
        );
        if (match) {
          // Start with cached Splitwise balance, then apply local Coconut settlement deltas
          const cachedByCurrency = new Map<string, number>();
          for (const b of match.balance ?? []) {
            const amt = parseFloat(b.amount);
            if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
            cachedByCurrency.set(normalizeSplitCurrency(b.currency_code), Math.round(amt * 100) / 100);
          }

          // Apply only LOCAL (non-Splitwise) settlements on top of cached Splitwise balances
          for (const groupId of sharedGroupIds) {
            const groupMembers = (members ?? []).filter((m) => m.group_id === groupId);
            const myMember = groupMembers.find((m) => m.user_id === userId);
            const theirMember = groupMembers.find((m) => personMemberIds.has(m.id));
            if (!myMember || !theirMember) continue;
            const gSettlements = (settlements ?? []).filter(
              (s) => s.group_id === groupId && (s as { method?: string }).method !== "splitwise"
            );
            for (const st of gSettlements) {
              const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
              const amt = Number(st.amount);
              if (st.payer_member_id === theirMember.id && st.receiver_member_id === myMember.id) {
                cachedByCurrency.set(cur, Math.round(((cachedByCurrency.get(cur) ?? 0) - amt) * 100) / 100);
              } else if (st.payer_member_id === myMember.id && st.receiver_member_id === theirMember.id) {
                cachedByCurrency.set(cur, Math.round(((cachedByCurrency.get(cur) ?? 0) + amt) * 100) / 100);
              }
            }
          }

          currencyBalances = [...cachedByCurrency.entries()]
            .map(([currency, amount]) => ({ currency, amount }))
            .filter((b) => Number.isFinite(b.amount) && Math.abs(b.amount) >= BALANCE_EPS)
            .sort((a, b) => a.currency.localeCompare(b.currency));
        }
      }
    } catch {
      // Ignore — fall back to recalculated
    }

    // Fall back to recalculated balances if no cached data
    if (currencyBalances.length === 0) {
      currencyBalances = [...byCurrency.entries()]
        .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
        .filter((b) => Math.abs(b.amount) >= BALANCE_EPS)
        .sort((a, b) => a.currency.localeCompare(b.currency));
    }

    const balance =
      currencyBalances.length === 1
        ? currencyBalances[0].amount
        : currencyBalances.length === 0
          ? 0
          : null;

    // Only show expenses that actually affect the pairwise balance
    const relevantActivity = activity.filter(
      (a) => Math.abs(a.effectOnBalance) >= BALANCE_EPS
    );

    return NextResponse.json({
      displayName,
      balance,
      currencyBalances,
      activity: relevantActivity,
      email,
      key,
      settlements: personSettlements,
      sharedGroupIds,
      sharedGroups,
      p2pHandles,
    });
  } catch (err) {
    console.error("[person]", err);
    return NextResponse.json({ error: "Failed to load person" }, { status: 500 });
  }
}
