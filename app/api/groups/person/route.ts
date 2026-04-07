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

    // Parallel fetch of groups and members (both only need accessible ids)
    const [{ data: groups }, { data: members }] = await Promise.all([
      db.from("groups").select("id, name, owner_id, source").in("id", ids),
      db.from("group_members")
        .select("id, group_id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username")
        .in("group_id", ids),
    ]);

    const directMatches = (members ?? []).filter((m) => {
      if (m.user_id === userId) return false;
      if (m.user_id && m.user_id === key) return true;
      if (m.email && m.email === key) return true;
      if (`${m.group_id}-${m.id}` === key) return true;
      return false;
    });

    // Widen the net: also match members by email or display_name from
    // direct matches. This catches auto-created 1:1 group members that
    // have the same email/name but a null user_id.
    const knownEmails = new Set(
      directMatches.map((m) => m.email?.toLowerCase()).filter(Boolean)
    );
    const knownNames = new Set(
      directMatches.map((m) => m.display_name?.trim().toLowerCase()).filter(Boolean)
    );

    // If key is a composite key (groupId-memberId), resolve the source member
    const memberIdFromKey =
      key.length > 37 && key[36] === "-" ? key.slice(37) : null;
    if (memberIdFromKey && directMatches.length === 0) {
      const srcMember = (members ?? []).find((m) => m.id === memberIdFromKey);
      if (srcMember) {
        if (srcMember.email) knownEmails.add(srcMember.email.toLowerCase());
        if (srcMember.display_name) knownNames.add(srcMember.display_name.trim().toLowerCase());
      }
    }

    const matchedIds = new Set(directMatches.map((m) => m.id));
    const personMembers = [...directMatches];

    if (knownEmails.size > 0 || knownNames.size > 0) {
      for (const m of members ?? []) {
        if (m.user_id === userId) continue;
        if (matchedIds.has(m.id)) continue;
        const emailMatch = m.email && knownEmails.has(m.email.toLowerCase());
        const nameMatch =
          !emailMatch &&
          knownEmails.size === 0 &&
          m.display_name &&
          knownNames.has(m.display_name.trim().toLowerCase());
        if (emailMatch || nameMatch) {
          personMembers.push(m);
          matchedIds.add(m.id);
        }
      }
    }

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

    // Detect Splitwise groups from the already-fetched groups data
    const swGroupIds = new Set(
      (groups ?? []).filter((g) => (g as { source?: string }).source === "splitwise" && sharedGroupIds.includes(g.id)).map((g) => g.id)
    );

    // Stage 2: parallel fetch of splits, settlements, and SW tokens
    type CachedFriend = {
      email: string | null;
      balance: { currency_code: string; amount: string }[];
    };
    const [{ data: splitsRaw }, { data: settlements }, swTokenResult] = await Promise.all([
      db
        .from("split_transactions")
        .select(`
          id, group_id, transaction_id, created_by, created_at, payer_member_id, amount, description,
          iso_currency_code, receipt_url,
          transactions(merchant_name, raw_name, amount, date)
        `)
        .in("group_id", sharedGroupIds)
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("settlements")
        .select("group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method")
        .in("group_id", sharedGroupIds)
        .eq("status", "completed"),
      swGroupIds.size > 0
        ? db.from("splitwise_tokens").select("cached_friend_balances").eq("clerk_user_id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    let swCachedFriends: CachedFriend[] | null = null;
    let hasSwCache = false;
    if (swGroupIds.size > 0 && swTokenResult.data) {
      swCachedFriends =
        (swTokenResult.data as Record<string, unknown> | null)
          ?.cached_friend_balances as CachedFriend[] | null;
      hasSwCache = !!(
        swCachedFriends &&
        Array.isArray(swCachedFriends) &&
        swCachedFriends.length > 0
      );
    }

    const seenByGroup = new Map<string, Set<string>>();
    const splits = (splitsRaw ?? []).filter((s) => {
      const seen = seenByGroup.get(s.group_id) ?? new Set();
      const dedupeKey = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);

      // Secondary dedup: catch duplicate splits with different IDs but identical content
      const desc = (s as { description?: string | null }).description ?? "";
      const amt = String((s as { amount?: unknown }).amount ?? "");
      const contentKey = `content:${desc}|${amt}|${s.payer_member_id ?? ""}|${s.created_at}`;
      if (seen.has(contentKey)) return false;
      seen.add(contentKey);

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

    // Stage 3: parallel fetch of shares and tx owners
    const splitIdList = splits.map((s) => s.id);
    const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
    const [sharesResult, txResult] = await Promise.all([
      db.from("split_shares").select("split_transaction_id, member_id, amount").in("split_transaction_id", splitIdList),
      txIds.length > 0
        ? db.from("transactions").select("id, clerk_user_id").in("id", txIds)
        : Promise.resolve({ data: null }),
    ]);
    const { data: shares } = sharesResult;
    const txRows: { id: string; clerk_user_id: string }[] = txResult.data ?? [];

    const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

    // Pre-index shares by split_transaction_id for O(1) lookups
    const sharesBySplitId = new Map<string, NonNullable<typeof shares>>();
    for (const sh of shares ?? []) {
      const list = sharesBySplitId.get(sh.split_transaction_id);
      if (list) list.push(sh);
      else sharesBySplitId.set(sh.split_transaction_id, [sh]);
    }

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

      const sharesByTx = new Map<string, Map<string, number>>();
      for (const s of groupSplits) {
        for (const sh of sharesBySplitId.get(s.id) ?? []) {
          let txMap = sharesByTx.get(sh.split_transaction_id);
          if (!txMap) { txMap = new Map(); sharesByTx.set(sh.split_transaction_id, txMap); }
          txMap.set(sh.member_id, Number(sh.amount));
        }
      }

      const payerBySplit = new Map<string, string>();
      for (const s of groupSplits) {
        const payerMemberId = (s as { payer_member_id?: string | null }).payer_member_id;
        const pid =
          payerMemberId && groupMembers.some((m) => m.id === payerMemberId)
            ? payerMemberId
            : (() => {
                const ownerId = txOwnerById.get(s.transaction_id);
                return ownerId ? memberByUserId.get(ownerId) ?? null : null;
              })();
        if (pid) payerBySplit.set(s.id, pid);
      }

      const groupSettlements = (settlements ?? []).filter((s) => s.group_id === groupId);

      // Skip pairwise for Splitwise groups when cache is authoritative.
      // The cached balance already covers them; computing here would double-count.
      const skipPairwise = hasSwCache && swGroupIds.has(groupId);
      if (!skipPairwise) {
        // Pairwise balance: only count transactions where I or they paid
        for (const s of groupSplits) {
          const cur = splitCurrencyById.get(s.id) ?? "USD";
          const txShares = sharesByTx.get(s.id);
          if (!txShares) continue;
          const payerId = payerBySplit.get(s.id);
          if (!payerId) continue;

          if (payerId === myMember.id) {
            const theirShare = txShares.get(theirMember.id) ?? 0;
            if (theirShare > 0) {
              const prev = byCurrency.get(cur) ?? 0;
              byCurrency.set(cur, Math.round((prev + theirShare) * 100) / 100);
            }
          } else if (payerId === theirMember.id) {
            const myShare = txShares.get(myMember.id) ?? 0;
            if (myShare > 0) {
              const prev = byCurrency.get(cur) ?? 0;
              byCurrency.set(cur, Math.round((prev - myShare) * 100) / 100);
            }
          }
        }

        // Pairwise settlement adjustments
        for (const st of groupSettlements) {
          const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
          const amt = Number(st.amount);
          if (st.payer_member_id === myMember.id && st.receiver_member_id === theirMember.id) {
            const prev = byCurrency.get(cur) ?? 0;
            byCurrency.set(cur, Math.round((prev + amt) * 100) / 100);
          } else if (st.payer_member_id === theirMember.id && st.receiver_member_id === myMember.id) {
            const prev = byCurrency.get(cur) ?? 0;
            byCurrency.set(cur, Math.round((prev - amt) * 100) / 100);
          }
        }
      }

      // Compute settlement suggestions using group-level balances (correct for suggestions)
      const paidRows: { member_id: string; amount: number; currency: string }[] = [];
      for (const s of groupSplits) {
        const pid = payerBySplit.get(s.id);
        if (pid) {
          const amt = paidAmountFromSplitRow(
            s as { transactions?: unknown; amount?: number | string | null }
          );
          if (amt > 0) {
            paidRows.push({
              member_id: pid,
              amount: amt,
              currency: splitCurrencyById.get(s.id) ?? "USD",
            });
          }
        }
      }

      const owedRows: { member_id: string; amount: number; currency: string }[] = [];
      for (const s of groupSplits) {
        for (const sh of sharesBySplitId.get(s.id) ?? []) {
          owedRows.push({
            member_id: sh.member_id,
            amount: Number(sh.amount),
            currency: splitCurrencyById.get(sh.split_transaction_id) ?? "USD",
          });
        }
      }

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
        const shareList = sharesBySplitId.get(s.id) ?? [];
        const txAmount = paidAmountFromSplitRow(
          s as { transactions?: unknown; amount?: number | string | null }
        );
        const cur = normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code);
        const payerMemberId = payerBySplit.get(s.id) ?? null;

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

    // Merge: start with non-Splitwise pairwise (byCurrency), then add
    // cached Splitwise balance on top (authoritative for SW groups).
    const mergedByCurrency = new Map(byCurrency);

    if (hasSwCache && swCachedFriends && email) {
      const match = swCachedFriends.find(
        (f) => (f.email ?? "").toLowerCase().trim() === email.toLowerCase().trim()
      );
      if (match) {
        for (const b of match.balance ?? []) {
          const amt = parseFloat(b.amount);
          if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
          const cur = normalizeSplitCurrency(b.currency_code);
          const prev = mergedByCurrency.get(cur) ?? 0;
          mergedByCurrency.set(cur, Math.round((prev + amt) * 100) / 100);
        }

        // Apply only LOCAL (non-Splitwise) settlements on top of cached balances
        for (const groupId of sharedGroupIds) {
          if (!swGroupIds.has(groupId)) continue;
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
              mergedByCurrency.set(cur, Math.round(((mergedByCurrency.get(cur) ?? 0) - amt) * 100) / 100);
            } else if (st.payer_member_id === myMember.id && st.receiver_member_id === theirMember.id) {
              mergedByCurrency.set(cur, Math.round(((mergedByCurrency.get(cur) ?? 0) + amt) * 100) / 100);
            }
          }
        }
      }
    }

    const currencyBalances = [...mergedByCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .filter((b) => Math.abs(b.amount) >= BALANCE_EPS)
      .sort((a, b) => a.currency.localeCompare(b.currency));

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

    // Secondary dedup: catch duplicate splits with different IDs but identical content
    // (e.g. same bank transaction split twice, or duplicate Plaid transactions)
    const seenContent = new Set<string>();
    const dedupedActivity = relevantActivity.filter((a) => {
      const sig = `${a.merchant}|${a.amount}|${a.effectOnBalance}|${a.groupName}|${a.createdAt}`;
      if (seenContent.has(sig)) return false;
      seenContent.add(sig);
      return true;
    });

    return NextResponse.json({
      displayName,
      balance,
      currencyBalances,
      activity: dedupedActivity,
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
