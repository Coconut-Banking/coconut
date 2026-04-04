export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { processRecurringExpenses } from "@/lib/recurring-expenses";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getAccessibleGroupIds } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";
import { getClerkUserPhotos } from "@/lib/clerk-user-lookup";
import {
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

/** Ignore sub–half-cent noise when deciding “settled” vs outstanding (Splitwise-style lists). */
const BALANCE_EPS = 0.005;

function scheduleProcessRecurringExpenses(userId: string) {
  void processRecurringExpenses(userId)
    .then((n) => {
      if (n > 0) {
        revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
        revalidateTag(CACHE_TAGS.transactions(userId), "max");
      }
    })
    .catch((err) => console.error("[recurring] background process failed:", err));
}

type PersonAgg = { displayName: string; byCurrency: Map<string, number>; lastActivityAt: string | null };

function addPersonCurrency(
  personBalances: Map<string, PersonAgg>,
  key: string,
  displayName: string,
  currency: string,
  delta: number,
  activityAt?: string | null,
) {
  const cur = normalizeSplitCurrency(currency);
  const d = Math.round(delta * 100) / 100;
  if (Math.abs(d) < BALANCE_EPS) return;
  const existing = personBalances.get(key) ?? { displayName, byCurrency: new Map(), lastActivityAt: null };
  existing.displayName = displayName;
  if (activityAt && (!existing.lastActivityAt || activityAt > existing.lastActivityAt)) {
    existing.lastActivityAt = activityAt;
  }
  const next = (existing.byCurrency.get(cur) ?? 0) + d;
  existing.byCurrency.set(cur, Math.round(next * 100) / 100);
  personBalances.set(key, existing);
}

function updatePersonActivity(
  personBalances: Map<string, PersonAgg>,
  key: string,
  displayName: string,
  activityAt: string,
) {
  const existing = personBalances.get(key) ?? { displayName, byCurrency: new Map(), lastActivityAt: null };
  if (!existing.lastActivityAt || activityAt > existing.lastActivityAt) {
    existing.lastActivityAt = activityAt;
  }
  personBalances.set(key, existing);
}

function friendRowFromAgg(key: string, v: PersonAgg, imageUrl?: string | null) {
  const balances = [...v.byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .filter((b) => Math.abs(b.amount) >= BALANCE_EPS)
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const balance = balances.length === 1 ? balances[0].amount : balances.length === 0 ? 0 : null;
  return { key, displayName: v.displayName, balance, balances, image_url: imageUrl ?? null, lastActivityAt: v.lastActivityAt };
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

  try {
  return await handleSummary(req, userId);
  } catch (err) {
    console.error("[summary] unhandled error:", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}

async function handleSummary(req: NextRequest, userId: string) {

  const db = getSupabaseAdmin();
  const ids = await getAccessibleGroupIds(userId);

  const showAll = req.nextUrl.searchParams.get("contacts") === "1";

  if (ids.length === 0) {
    scheduleProcessRecurringExpenses(userId);
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

  let groupsRaw: { id: string; name: string; owner_id: string; created_at: string; group_type?: string; source?: string | null; external_id?: string | null; archived_at?: string | null; image_url?: string | null }[] | null;
  {
    const res = await db
      .from("groups")
      .select("id, name, owner_id, created_at, group_type, source, external_id, archived_at, image_url")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (res.error?.code === "42703") {
      console.warn("[summary] image_url column not found — falling back. Run: ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_url text;");
      const fallback = await db
        .from("groups")
        .select("id, name, owner_id, created_at, group_type, source, external_id")
        .in("id", ids)
        .order("created_at", { ascending: false });
      groupsRaw = fallback.data;
    } else {
      groupsRaw = res.data;
    }
  }

  const nonArchived = (groupsRaw ?? []).filter((g) => !g.archived_at);

  // Deduplicate groups with the same (source, external_id) — keep the newest.
  // This handles Splitwise re-imports that created duplicate group records before
  // the unique index was applied.
  const seenExternal = new Map<string, typeof nonArchived[0]>();
  const groups = nonArchived.filter((g) => {
    if (!g.source || !g.external_id) return true;
    const key = `${g.source}:${g.external_id}`;
    const prev = seenExternal.get(key);
    if (!prev) { seenExternal.set(key, g); return true; }
    if (g.created_at > prev.created_at) {
      seenExternal.set(key, g);
      return true;
    }
    return false;
  });
  // Remove older duplicates that initially passed the filter
  const keepIds = new Set(seenExternal.values());
  const dedupedGroups = groups.filter((g) => {
    if (!g.source || !g.external_id) return true;
    return keepIds.has(g);
  });

  const groupIds = dedupedGroups.map((g) => g.id);

  const BATCH_SIZE = 200;

  async function batchIn<T>(
    table: string,
    selectCols: string,
    column: string,
    ids: string[],
    extraFilters?: (q: ReturnType<ReturnType<typeof db.from>["select"]>) => ReturnType<ReturnType<typeof db.from>["select"]>,
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    const results: T[] = [];
    const batches: Promise<T[]>[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      batches.push(
        (async () => {
          let q = db.from(table).select(selectCols).in(column, chunk) as ReturnType<ReturnType<typeof db.from>["select"]>;
          if (extraFilters) q = extraFilters(q);
          const { data } = await q;
          return (data ?? []) as T[];
        })()
      );
    }
    const batchResults = await Promise.all(batches);
    for (const b of batchResults) results.push(...b);
    return results;
  }

  const [members, splits] = await Promise.all([
    batchIn<{ id: string; group_id: string; user_id: string | null; display_name: string; email: string | null }>(
      "group_members",
      "id, group_id, user_id, display_name, email",
      "group_id",
      groupIds,
    ),
    batchIn<{
      id: string; group_id: string; transaction_id: string | null; created_by: string | null;
      created_at: string; date: string | null; payer_member_id: string | null; amount: number | null; description: string | null;
      iso_currency_code: string | null; transactions: { amount: number } | null;
    }>(
      "split_transactions",
      `id, group_id, transaction_id, created_by, created_at, date, payer_member_id, amount, description, iso_currency_code, transactions(amount)`,
      "group_id",
      groupIds,
    ),
  ]);
  splits.sort((a, b) => {
    const aDate = a.date ?? a.created_at;
    const bDate = b.date ?? b.created_at;
    return bDate > aDate ? 1 : bDate < aDate ? -1 : 0;
  });

  const splitIds = splits.map((s) => s.id);
  const txIds = splits.map((s) => s.transaction_id).filter(Boolean) as string[];

  const [shares, txRows, settlements] = await Promise.all([
    batchIn<{ split_transaction_id: string; member_id: string; amount: number }>(
      "split_shares",
      "split_transaction_id, member_id, amount",
      "split_transaction_id",
      splitIds,
    ),
    batchIn<{ id: string; clerk_user_id: string }>(
      "transactions",
      "id, clerk_user_id",
      "id",
      txIds,
    ),
    batchIn<{ group_id: string; payer_member_id: string; receiver_member_id: string; amount: number; iso_currency_code: string | null; method: string | null }>(
      "settlements",
      "group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method",
      "group_id",
      groupIds,
      (q) => q.eq("status", "completed"),
    ),
  ]);

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

  // Fire splitwise_tokens fetch in parallel with balance computation below
  const splitwiseTokensPromise = db
    .from("splitwise_tokens")
    .select("cached_friend_balances, cached_group_balances")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const personBalances = new Map<string, PersonAgg>();

  const groupsWithBalance = (dedupedGroups ?? []).map((g) => {
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
        imageUrl: g.image_url ?? null,
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

          const activityTs = (s as { date?: string | null }).date ?? s.created_at;
          const involvedInSplit = txShares.has(m.id) || payerId === m.id;
          if (involvedInSplit) {
            updatePersonActivity(personBalances, key, m.display_name, activityTs);
          }

          if (payerId === myMember.id) {
            const theirShare = txShares.get(m.id) ?? 0;
            if (theirShare > 0) addPersonCurrency(personBalances, key, m.display_name, cur, theirShare, activityTs);
          } else if (payerId === m.id) {
            const myShare = txShares.get(myMember.id) ?? 0;
            if (myShare > 0) addPersonCurrency(personBalances, key, m.display_name, cur, -myShare, activityTs);
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
    const lastActivityAt = (lastSplit as { date?: string | null } | undefined)?.date ?? lastSplit?.created_at ?? g.created_at;

    return {
      id: g.id,
      name: g.name,
      groupType: (g as { group_type?: string }).group_type ?? "other",
      imageUrl: g.image_url ?? null,
      memberCount: groupMembers.length,
      myBalance,
      myBalances,
      lastActivityAt,
    };
  });

  // Try to use cached Splitwise balances (authoritative) instead of recalculated ones.
  // Splitwise's balance engine handles multi-payer, debt simplification, etc. correctly.
  {
    // Await the splitwise_tokens fetch that was fired in parallel above
    const tokenRes = await splitwiseTokensPromise;
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
        (dedupedGroups ?? [])
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

      // Build per-person local settlement deltas (Coconut settlements not yet reflected in Splitwise cache).
      // These must be subtracted from the cached balance so "mark as paid" works immediately.
      const localSettlementDeltas = new Map<string, Map<string, number>>();
      for (const m of members ?? []) {
        if (m.user_id === userId || !m.email) continue;
        const myMember = memberByGroup.get(m.group_id)?.find((mm) => mm.user_id === userId);
        if (!myMember) continue;
        const gSettlements = (settlements ?? []).filter(
          (s) => s.group_id === m.group_id && (s as { method?: string }).method !== "splitwise"
        );
        for (const st of gSettlements) {
          const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
          const amt = Number(st.amount);
          const personKey = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
          if (!localSettlementDeltas.has(personKey)) localSettlementDeltas.set(personKey, new Map());
          const pMap = localSettlementDeltas.get(personKey)!;
          if (st.payer_member_id === m.id && st.receiver_member_id === myMember.id) {
            pMap.set(cur, (pMap.get(cur) ?? 0) + amt);
          } else if (st.payer_member_id === myMember.id && st.receiver_member_id === m.id) {
            pMap.set(cur, (pMap.get(cur) ?? 0) - amt);
          }
        }
      }

      // Replace personBalances with cached Splitwise balances, then apply local settlement deltas
      for (const cf of cached) {
        if (!cf || typeof cf !== "object" || !Array.isArray(cf.balance)) continue;
        const email = (cf.email ?? "").toLowerCase().trim();
        const match = memberEmailToKey.get(email);
        if (!match) continue;
        const newByCurrency = new Map<string, number>();
        for (const b of cf.balance) {
          const amt = parseFloat(b.amount);
          if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
          const cur = normalizeSplitCurrency(b.currency_code);
          newByCurrency.set(cur, Math.round(amt * 100) / 100);
        }
        // Apply local Coconut settlements on top of cached Splitwise balance
        const deltas = localSettlementDeltas.get(match.key);
        if (deltas) {
          for (const [cur, delta] of deltas) {
            const current = newByCurrency.get(cur) ?? 0;
            const adjusted = Math.round((current + delta) * 100) / 100;
            if (Math.abs(adjusted) < BALANCE_EPS) newByCurrency.delete(cur);
            else newByCurrency.set(cur, adjusted);
          }
        }
        personBalances.set(match.key, { displayName: match.displayName, byCurrency: newByCurrency, lastActivityAt: personBalances.get(match.key)?.lastActivityAt ?? null });
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
          personBalances.set(key, { displayName: m.display_name, byCurrency: new Map(), lastActivityAt: null });
        }
      }

      // Add cached Splitwise friends who aren't members of any imported group.
      // This handles pairwise balances outside of groups (e.g. direct expenses).
      const matchedEmails = new Set(
        [...memberEmailToKey.keys()].map((e) => e.toLowerCase().trim())
      );
      for (const cf of cached) {
        const email = (cf.email ?? "").toLowerCase().trim();
        if (!email || matchedEmails.has(email)) continue;
        const name = [cf.first_name, cf.last_name].filter(Boolean).join(" ") || email;
        const key = email;
        const newByCurrency = new Map<string, number>();
        for (const b of cf.balance ?? []) {
          const amt = parseFloat(b.amount);
          if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
          const cur = normalizeSplitCurrency(b.currency_code);
          newByCurrency.set(cur, Math.round(amt * 100) / 100);
        }
        personBalances.set(key, { displayName: name, byCurrency: newByCurrency, lastActivityAt: null });
      }
    }

    // Override group-level balances with Splitwise's authoritative simplified_debts.
    type CachedGroupBalance = {
      external_id: string;
      balances: { currency_code: string; amount: string }[];
    };
    const cachedGroups: CachedGroupBalance[] | null =
      (tokenRow as Record<string, unknown> | null)?.cached_group_balances as CachedGroupBalance[] | null;

    if (cachedGroups && Array.isArray(cachedGroups) && cachedGroups.length > 0) {
      const groupCacheMap = new Map(cachedGroups.map((g) => [g.external_id, g.balances]));

      for (const g of groupsWithBalance) {
        const row = (dedupedGroups ?? []).find((gr) => gr.id === g.id);
        if (row?.source !== "splitwise" || !row.external_id) continue;
        const cachedBals = groupCacheMap.get(row.external_id);
        if (!cachedBals) continue;

        const newBalances = cachedBals
          .map((b) => ({
            currency: normalizeSplitCurrency(b.currency_code),
            amount: Math.round(parseFloat(b.amount) * 100) / 100,
          }))
          .filter((b) => Number.isFinite(b.amount) && Math.abs(b.amount) >= BALANCE_EPS);
        newBalances.sort((a, b) => a.currency.localeCompare(b.currency));

        g.myBalances = newBalances;
        g.myBalance =
          newBalances.length === 1 ? newBalances[0].amount : newBalances.length === 0 ? 0 : null;
      }
    }
  }

  {
    const allMembers = members ?? [];
    for (const m of allMembers) {
      if (m.user_id === userId) continue;
      const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
      if (!personBalances.has(key)) {
        personBalances.set(key, { displayName: m.display_name, byCurrency: new Map(), lastActivityAt: null });
      }
    }
  }

  // Deduplicate person entries that share the same display name but ended up
  // with different keys (e.g., one group member has email, another doesn't).
  // Merge their per-currency balances and keep the first key encountered.
  {
    const byName = new Map<string, { canonicalKey: string; agg: PersonAgg }>();
    for (const [key, agg] of personBalances) {
      const normName = agg.displayName.trim().toLowerCase();
      const existing = byName.get(normName);
      if (!existing) {
        byName.set(normName, { canonicalKey: key, agg: { displayName: agg.displayName, byCurrency: new Map(agg.byCurrency), lastActivityAt: agg.lastActivityAt } });
      } else {
        for (const [cur, amt] of agg.byCurrency) {
          const prev = existing.agg.byCurrency.get(cur) ?? 0;
          const merged = Math.round((prev + amt) * 100) / 100;
          if (Math.abs(merged) < BALANCE_EPS) existing.agg.byCurrency.delete(cur);
          else existing.agg.byCurrency.set(cur, merged);
        }
        if (agg.lastActivityAt && (!existing.agg.lastActivityAt || agg.lastActivityAt > existing.agg.lastActivityAt)) {
          existing.agg.lastActivityAt = agg.lastActivityAt;
        }
      }
    }
    personBalances.clear();
    for (const { canonicalKey, agg } of byName.values()) {
      personBalances.set(canonicalKey, agg);
    }
  }

  // Batch-fetch Clerk profile photos for friends with linked user_ids.
  const friendKeyToUserId = new Map<string, string>();
  for (const m of members ?? []) {
    if (m.user_id === userId || !m.user_id) continue;
    const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
    if (personBalances.has(key) && !friendKeyToUserId.has(key)) {
      friendKeyToUserId.set(key, m.user_id);
    }
  }
  const friendUserIds = [...new Set(friendKeyToUserId.values())];
  const friendPhotoMap = friendUserIds.length > 0 ? await getClerkUserPhotos(friendUserIds) : new Map<string, string>();
  const friendKeyToPhoto = new Map<string, string>();
  for (const [key, uid] of friendKeyToUserId) {
    const url = friendPhotoMap.get(uid);
    if (url) friendKeyToPhoto.set(key, url);
  }

  let friends = Array.from(personBalances.entries())
    .map(([key, v]) => friendRowFromAgg(key, v, friendKeyToPhoto.get(key)))
    .sort((a, b) => {
      const aHasBalance = a.balances.length > 0 ? 1 : 0;
      const bHasBalance = b.balances.length > 0 ? 1 : 0;
      if (aHasBalance !== bHasBalance) return bHasBalance - aHasBalance;
      const aTime = a.lastActivityAt ?? "";
      const bTime = b.lastActivityAt ?? "";
      if (aTime !== bTime) return bTime > aTime ? 1 : -1;
      return a.displayName.localeCompare(b.displayName);
    });

  let groupsOut = [...groupsWithBalance].sort((a, b) => {
    const aHasBalance = (a.myBalances?.length ?? 0) > 0 ? 1 : 0;
    const bHasBalance = (b.myBalances?.length ?? 0) > 0 ? 1 : 0;
    if (aHasBalance !== bHasBalance) return bHasBalance - aHasBalance;
    const aTime = a.lastActivityAt ?? "";
    const bTime = b.lastActivityAt ?? "";
    if (aTime !== bTime) return bTime > aTime ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  if (showAll) {
    // Return everything (incl. settled) — no filtering.
  } else {
    // Splitwise-style: only show friends with non-zero pairwise balance.
    friends = friends.filter((f) => f.balances.length > 0);
    groupsOut = groupsOut.filter((g) => (g.myBalances?.length ?? 0) > 0);
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
    showAll,
    totalsByCurrency: totalsByCurrency.length,
  });

  scheduleProcessRecurringExpenses(userId);

  return NextResponse.json(
    {
      groups: groupsOut,
      friends,
      totalOwedToMe,
      totalIOwe,
      netBalance,
      totalsByCurrency,
    },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
  );
}
