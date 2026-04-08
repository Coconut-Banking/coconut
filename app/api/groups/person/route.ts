export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
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
    const db = getSupabaseAdmin();
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

    async function paginateAll<T>(
      buildQuery: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }> & { range?: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
      pageSize = 1000,
    ): Promise<T[]> {
      const first = buildQuery();
      if (typeof first.range !== "function") { const { data } = await first; return data ?? []; }
      const all: T[] = [];
      let offset = 0;
      for (;;) {
        const q = offset === 0 ? first : buildQuery();
        const { data, error } = await q.range!(offset, offset + pageSize - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
      }
      return all;
    }

    // Parallel fetch of groups and members (both only need accessible ids)
    const [groupsRaw, membersRaw] = await Promise.all([
      paginateAll(() =>
        db.from("groups").select("id, name, owner_id, source, group_type, external_id").in("id", ids)
      ),
      paginateAll(() =>
        db.from("group_members")
          .select("id, group_id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username")
          .in("group_id", ids)
      ),
    ]);

    // Deduplicate Splitwise imports (same logic as summary)
    const activeGroups = [...(groupsRaw ?? [])];
    activeGroups.sort((a, b) => (a.owner_id === userId ? 0 : 1) - (b.owner_id === userId ? 0 : 1));
    const seenExtIds = new Set<string>();
    const groups = activeGroups.filter((g) => {
      const src = (g as { source?: string | null }).source;
      const extId = (g as { external_id?: string | null }).external_id;
      if (src === "splitwise" && extId) {
        if (seenExtIds.has(extId)) return false;
        seenExtIds.add(extId);
      }
      return true;
    });
    const dedupedGroupIds = new Set(groups.map((g) => g.id));
    const members = (membersRaw ?? []).filter((m) => dedupedGroupIds.has(m.group_id));

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
      // Run Splitwise and Clerk fallbacks in parallel
      const [swFallback, clerkFallback] = await Promise.all([
        key.includes("@") ? getSplitwiseCachedFriend(userId, key) : Promise.resolve(null),
        key.startsWith("user_") ? getClerkUserStub(key) : Promise.resolve(null),
      ]);
      const fallback = swFallback ?? clerkFallback;
      if (fallback) return NextResponse.json(fallback);

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
    const groupTypeById = new Map((groups ?? []).map((g) => [g.id, (g as { group_type?: string | null }).group_type ?? null]));
    const memberCountByGroup = new Map<string, number>();
    for (const m of members ?? []) {
      memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
    }
    const sharedGroups = sharedGroupIds
      .map((id) => ({
        id,
        name: groupNameById.get(id) ?? "Group",
        memberCount: memberCountByGroup.get(id) ?? 0,
        groupType: groupTypeById.get(id) ?? null,
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
    const [splitsRaw, settlements, swTokenResult] = await Promise.all([
      paginateAll(() =>
        db.from("split_transactions")
          .select(`id, group_id, transaction_id, created_by, created_at, payer_member_id, amount, description, iso_currency_code, receipt_url, transactions(merchant_name, raw_name, amount, date)`)
          .in("group_id", sharedGroupIds)
          .order("created_at", { ascending: false })
      ),
      paginateAll(() =>
        db.from("settlements")
          .select("group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method")
          .in("group_id", sharedGroupIds)
          .eq("status", "completed")
      ),
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
      seenByGroup.set(s.group_id, seen);
      return true;
    });

    // Stage 3: parallel fetch of shares and tx owners (skip if no splits)
    const splitIdList = splits.map((s) => s.id);
    const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
    let shares: { split_transaction_id: string; member_id: string; amount: number }[] | null = null;
    let txRows: { id: string; clerk_user_id: string }[] = [];
    if (splitIdList.length > 0) {
      const BATCH = 200;
      const sharesBatches: Promise<{ split_transaction_id: string; member_id: string; amount: number }[]>[] = [];
      for (let i = 0; i < splitIdList.length; i += BATCH) {
        const batch = splitIdList.slice(i, i + BATCH);
        sharesBatches.push(
          paginateAll(() =>
            db.from("split_shares")
              .select("split_transaction_id, member_id, amount")
              .in("split_transaction_id", batch)
          )
        );
      }
      const txBatches: Promise<{ id: string; clerk_user_id: string }[]>[] = [];
      for (let i = 0; i < txIds.length; i += BATCH) {
        const batch = txIds.slice(i, i + BATCH);
        txBatches.push(
          paginateAll(() =>
            db.from("transactions")
              .select("id, clerk_user_id")
              .in("id", batch)
          )
        );
      }
      const [sharesResults, txResults] = await Promise.all([
        Promise.all(sharesBatches),
        Promise.all(txBatches),
      ]);
      shares = sharesResults.flat();
      txRows = txResults.flat();
    }

    const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

    // Pre-index shares by split_transaction_id for O(1) lookups
    const sharesBySplitId = new Map<string, NonNullable<typeof shares>>();
    for (const sh of shares ?? []) {
      const list = sharesBySplitId.get(sh.split_transaction_id);
      if (list) list.push(sh);
      else sharesBySplitId.set(sh.split_transaction_id, [sh]);
    }

    // Pre-index splits, members, settlements by group_id for O(1) per-group access
    const splitsByGroup = new Map<string, typeof splits>();
    for (const s of splits) {
      const list = splitsByGroup.get(s.group_id) ?? [];
      list.push(s);
      splitsByGroup.set(s.group_id, list);
    }

    const membersByGroupId = new Map<string, NonNullable<typeof members>[number][]>();
    for (const m of members ?? []) {
      const list = membersByGroupId.get(m.group_id) ?? [];
      list.push(m);
      membersByGroupId.set(m.group_id, list);
    }

    const settlementsByGroupId = new Map<string, NonNullable<typeof settlements>[number][]>();
    for (const s of settlements ?? []) {
      const list = settlementsByGroupId.get(s.group_id) ?? [];
      list.push(s);
      settlementsByGroupId.set(s.group_id, list);
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
      groupType: string | null;
      paidByMe: boolean;
      paidByThem: boolean;
      myShare: number;
      theirShare: number;
      effectOnBalance: number;
      createdAt: string;
      receiptUrl: string | null;
    }> = [];

    for (const groupId of sharedGroupIds) {
      const groupSplits = splitsByGroup.get(groupId) ?? [];
      const groupMembers = membersByGroupId.get(groupId) ?? [];
      const myMember = groupMembers.find((m) => m.user_id === userId);
      const theirMember = groupMembers.find((m) => personMemberIds.has(m.id));
      if (!myMember || !theirMember) continue;

      const memberByUserId = new Map(
        groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
      );
      const groupMemberIdSet = new Set(groupMembers.map((m) => m.id));

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
          payerMemberId && groupMemberIdSet.has(payerMemberId)
            ? payerMemberId
            : (() => {
                const ownerId = txOwnerById.get(s.transaction_id);
                return ownerId ? memberByUserId.get(ownerId) ?? null : null;
              })();
        if (pid) payerBySplit.set(s.id, pid);
      }

      const groupSettlements = settlementsByGroupId.get(groupId) ?? [];

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

      // Pre-index shares by split_id + member_id for O(1) lookups
      const shareAmountBySplitMember = new Map<string, number>();
      for (const [splitId, shareList] of sharesBySplitId) {
        for (const sh of shareList) {
          shareAmountBySplitMember.set(`${splitId}:${sh.member_id}`, Number(sh.amount));
        }
      }

      for (const s of groupSplits) {
        const txAmount = paidAmountFromSplitRow(
          s as { transactions?: unknown; amount?: number | string | null }
        );
        const cur = normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code);
        const payerMemberId = payerBySplit.get(s.id) ?? null;

        const paidByMe = payerMemberId === myMember.id;
        const paidByThem = payerMemberId === theirMember.id;
        const myShare = shareAmountBySplitMember.get(`${s.id}:${myMember.id}`) ?? 0;
        const theirShare = shareAmountBySplitMember.get(`${s.id}:${theirMember.id}`) ?? 0;

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
          groupType: groupTypeById.get(groupId) ?? null,
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

    console.log("[person]", key, {
      sharedGroupIds,
      totalSplits: splits.length,
      totalShares: (shares ?? []).length,
      activityCount: activity.length,
      pairwiseByCurrency: Object.fromEntries(byCurrency),
      hasSwCache,
      swGroupCount: swGroupIds.size,
    });

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
          const groupMembers = membersByGroupId.get(groupId) ?? [];
          const myMember = groupMembers.find((m) => m.user_id === userId);
          const theirMember = groupMembers.find((m) => personMemberIds.has(m.id));
          if (!myMember || !theirMember) continue;
          const gSettlements = (settlementsByGroupId.get(groupId) ?? []).filter(
            (s) => (s as { method?: string }).method !== "splitwise"
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

    const _debug = {
      sharedGroupIds,
      totalSplits: splits.length,
      totalShares: (shares ?? []).length,
      activityBeforeFilter: activity.length,
      activityAfterFilter: dedupedActivity.length,
      perGroup: sharedGroupIds.map((gid) => {
        const gs = splitsByGroup.get(gid) ?? [];
        const gm = membersByGroupId.get(gid) ?? [];
        const myM = gm.find((m) => m.user_id === userId);
        const theirM = gm.find((m) => personMemberIds.has(m.id));
        const splitIds = new Set(gs.map((s) => s.id));
        const sharesForGroup = (shares ?? []).filter((sh) => splitIds.has(sh.split_transaction_id));
        const gmIdSet = new Set(gm.map((m) => m.id));
        const payersFound = gs.filter((s) => {
          const pmid = (s as { payer_member_id?: string | null }).payer_member_id;
          if (pmid && gmIdSet.has(pmid)) return true;
          const oid = s.transaction_id ? txOwnerById.get(s.transaction_id) : undefined;
          const memberByUid = new Map(gm.filter((m) => m.user_id).map((m) => [m.user_id!, m.id]));
          return oid ? !!memberByUid.get(oid) : false;
        });
        return {
          groupId: gid,
          groupName: groupNameById.get(gid),
          splitCount: gs.length,
          shareCount: sharesForGroup.length,
          memberCount: gm.length,
          hasMyMember: !!myM,
          hasTheirMember: !!theirM,
          payerFoundCount: payersFound.length,
          splitDetails: gs.slice(0, 5).map((s) => ({
            id: s.id,
            transaction_id: s.transaction_id,
            payer_member_id: (s as { payer_member_id?: string | null }).payer_member_id,
            sharesCount: (sharesBySplitId.get(s.id) ?? []).length,
            shares: (sharesBySplitId.get(s.id) ?? []).map((sh) => ({
              member_id: sh.member_id,
              amount: sh.amount,
            })),
          })),
        };
      }),
    };

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
      _debug,
    }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
  } catch (err) {
    console.error("[person]", err);
    return NextResponse.json({ error: "Failed to load person" }, { status: 500 });
  }
}

type CachedFriend = {
  first_name?: string;
  last_name?: string;
  email: string | null;
  balance: { currency_code: string; amount: string }[];
};

async function getSplitwiseCachedFriend(userId: string, email: string) {
  try {
    const db = getSupabaseAdmin();
    const { data: tokenRow } = await db
      .from("splitwise_tokens")
      .select("cached_friend_balances")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    const cached = (tokenRow as Record<string, unknown> | null)
      ?.cached_friend_balances as CachedFriend[] | null;
    if (!cached || !Array.isArray(cached)) return null;

    const match = cached.find(
      (f) => (f.email ?? "").toLowerCase().trim() === email.toLowerCase().trim()
    );
    if (!match) return null;

    const name = [match.first_name, match.last_name].filter(Boolean).join(" ") || email;
    const currencyBalances = (match.balance ?? [])
      .map((b) => ({
        currency: normalizeSplitCurrency(b.currency_code),
        amount: Math.round(parseFloat(b.amount) * 100) / 100,
      }))
      .filter((b) => Math.abs(b.amount) >= BALANCE_EPS);

    const balance =
      currencyBalances.length === 1
        ? currencyBalances[0].amount
        : currencyBalances.length === 0
          ? 0
          : null;

    return {
      displayName: name,
      balance,
      currencyBalances,
      activity: [],
      email,
      key: email,
      settlements: [],
      sharedGroupIds: [],
      sharedGroups: [],
      p2pHandles: { venmo_username: null, cashapp_cashtag: null, paypal_username: null },
      _source: "splitwise_cache",
    };
  } catch (err) {
    console.warn("[person] splitwise cache fallback failed:", err);
    return null;
  }
}

async function getClerkUserStub(clerkUserId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const first = user.firstName ?? "";
    const last = user.lastName ?? "";
    const name = [first, last].filter(Boolean).join(" ") || null;
    const email = user.primaryEmailAddress?.emailAddress ?? null;

    return {
      displayName: name,
      balance: 0,
      currencyBalances: [],
      activity: [],
      email,
      key: clerkUserId,
      settlements: [],
      sharedGroupIds: [],
      sharedGroups: [],
      p2pHandles: { venmo_username: null, cashapp_cashtag: null, paypal_username: null },
      _source: "clerk_user",
    };
  } catch (err) {
    console.warn("[person] clerk user fallback failed:", err);
    return null;
  }
}
