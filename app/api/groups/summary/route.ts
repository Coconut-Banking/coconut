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
import { getGroups as getSwGroups } from "@/lib/splitwise";
import { decryptToken } from "@/lib/encryption";

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

function friendRowFromAgg(
  key: string,
  v: PersonAgg,
  fg?: { groupId: string; members: { id: string; user_id: string | null; display_name: string }[] },
) {
  const balances = [...v.byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .filter((b) => Math.abs(b.amount) >= BALANCE_EPS)
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const balance = balances.length === 1 ? balances[0].amount : balances.length === 0 ? 0 : null;
  return {
    key,
    displayName: v.displayName,
    balance,
    balances,
    ...(fg ? { friendGroupId: fg.groupId, friendGroupMembers: fg.members } : {}),
  };
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

  // Migrate any leftover base64 data URIs to Supabase Storage in the background.
  // Strip them from this response to keep the payload small; the next request
  // will return the proper storage URL.
  const dataUriGroups = (groupsRaw ?? []).filter((g) => g.image_url?.startsWith("data:"));
  if (dataUriGroups.length > 0) {
    void Promise.all(dataUriGroups.map(async (g) => {
      try {
        const match = g.image_url!.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) return;
        const contentType = match[1];
        const base64Data = match[2];
        const ext = contentType === "image/png" ? "png" : "jpg";
        const buffer = Buffer.from(base64Data, "base64");
        const path = `${g.id}.${ext}`;
        const { error: upErr } = await db.storage.from("group-icons").upload(path, buffer, { contentType, upsert: true });
        if (upErr) { console.warn("[summary] migrate image failed for", g.id, upErr.message); return; }
        const { data: urlData } = db.storage.from("group-icons").getPublicUrl(path);
        await db.from("groups").update({ image_url: urlData.publicUrl }).eq("id", g.id);
        console.log("[summary] migrated data URI to storage for group", g.id);
      } catch (e) {
        console.warn("[summary] migrate image error for", g.id, e);
      }
    }));
    for (const g of dataUriGroups) g.image_url = null;
  }

  // Deduplicate Splitwise-imported groups: when multiple users import the same
  // SW group, linkMemberByEmail makes all copies accessible. Keep only the
  // user's own copy (by external_id), falling back to the first encountered.
  const deduped = (groupsRaw ?? []).filter((g) => !g.archived_at);
  deduped.sort((a, b) => {
    const aOwned = a.owner_id === userId ? 0 : 1;
    const bOwned = b.owner_id === userId ? 0 : 1;
    return aOwned - bOwned;
  });
  const seenExtIds = new Set<string>();
  const groups = deduped.filter((g) => {
    if (g.source === "splitwise" && g.external_id) {
      if (seenExtIds.has(g.external_id)) return false;
      seenExtIds.add(g.external_id);
    }
    return true;
  });

  const groupIds = groups.map((g) => g.id);

  // Paginate through Supabase results to bypass PostgREST max_rows (default 1000).
  // buildQuery returns a query builder; paginate calls .range() on it in pages.
  // Falls back to a single query if .range() is unavailable (e.g. in test mocks).
  async function paginate<T>(
    buildQuery: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }> & { range?: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
    pageSize = 1000,
  ): Promise<T[]> {
    const first = buildQuery();
    if (typeof first.range !== "function") {
      const { data } = await first;
      return data ?? [];
    }
    const all: T[] = [];
    let offset = 0;
    for (;;) {
      const q = offset === 0 ? first : buildQuery();
      const { data, error } = await q.range!(offset, offset + pageSize - 1);
      if (error) { console.warn("[summary] paginate error:", error.message); break; }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  // Stage 1: parallel fetch of members, splits, settlements, and SW tokens
  const [members, splits, settlements, swTokenResult] = await Promise.all([
    paginate(() =>
      db.from("group_members")
        .select("id, group_id, user_id, display_name, email")
        .in("group_id", groupIds)
    ),
    paginate(() =>
      db.from("split_transactions")
        .select(`id, group_id, transaction_id, created_by, created_at, payer_member_id, amount, description, iso_currency_code, source, transactions(amount)`)
        .in("group_id", groupIds)
        .order("created_at", { ascending: false })
    ),
    paginate(() =>
      db.from("settlements")
        .select("group_id, payer_member_id, receiver_member_id, amount, iso_currency_code, method")
        .in("group_id", groupIds)
        .eq("status", "completed")
    ),
    db.from("splitwise_tokens")
      .select("access_token, cached_friend_balances, cached_group_balances")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
  ]);

  // Stage 2: parallel fetch of shares and tx owners (depend on splits)
  const splitIds = splits.map((s: { id: string }) => s.id);
  const txIds = splits.map((s: { transaction_id?: string }) => s.transaction_id).filter(Boolean) as string[];

  let shares: { split_transaction_id: string; member_id: string; amount: number }[] = [];
  let txRows: { id: string; clerk_user_id: string }[] = [];

  if (splitIds.length > 0 || txIds.length > 0) {
    const BATCH = 200;
    const sharesBatches: Promise<{ split_transaction_id: string; member_id: string; amount: number }[]>[] = [];
    for (let i = 0; i < splitIds.length; i += BATCH) {
      const batch = splitIds.slice(i, i + BATCH);
      sharesBatches.push(
        paginate(() =>
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
        paginate(() =>
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

  const memberByGroup = new Map<string, { id: string; user_id: string | null; display_name: string; email: string | null }[]>();
  for (const m of members ?? []) {
    const list = memberByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, user_id: m.user_id, display_name: m.display_name, email: m.email ?? null });
    memberByGroup.set(m.group_id, list);
  }

  const txOwnerById = new Map(txRows.map((t) => [t.id, t.clerk_user_id]));

  // Pre-index shares by split_transaction_id for O(1) lookups
  const sharesBySplitId = new Map<string, typeof shares>();
  for (const sh of shares) {
    const list = sharesBySplitId.get(sh.split_transaction_id);
    if (list) list.push(sh);
    else sharesBySplitId.set(sh.split_transaction_id, [sh]);
  }

  // Pre-index settlements by group_id for O(1) lookups inside groups.map() (O(n²) → O(1)).
  const settlementsByGroup = new Map<string, typeof settlements>();
  for (const s of settlements) {
    const list = settlementsByGroup.get(s.group_id) ?? [];
    list.push(s);
    settlementsByGroup.set(s.group_id, list);
  }

  // Pre-compute myMember for each group to avoid repeated find() inside groups.map().
  const myMemberByGroupId = new Map<
    string,
    { id: string; user_id: string | null; display_name: string; email: string | null } | null
  >();
  for (const [gid, gMembers] of memberByGroup) {
    myMemberByGroupId.set(gid, gMembers.find((m) => m.user_id === userId) ?? null);
  }

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

  const swGroupIds = new Set(
    (groups ?? []).filter((g) => g.source === "splitwise").map((g) => g.id)
  );
  const swTokenRow =
    swTokenResult.error?.code === "PGRST204"
      ? null
      : (swTokenResult.data as Record<string, unknown> | null);
  const cachedSwFriends = swTokenRow?.cached_friend_balances as
    | unknown[]
    | null;
  const hasSwCache = !!(
    cachedSwFriends &&
    Array.isArray(cachedSwFriends) &&
    cachedSwFriends.length > 0
  );

  const personBalances = new Map<string, PersonAgg>();

  // Build person key → friend group mapping for 2-person "friend" groups.
  // This lets the client skip the /api/groups/person + /members round trips.
  const personFriendGroup = new Map<string, {
    groupId: string;
    members: { id: string; user_id: string | null; display_name: string }[];
  }>();
  for (const g of groups ?? []) {
    if ((g as { group_type?: string }).group_type !== "friend") continue;
    const gm = memberByGroup.get(g.id) ?? [];
    if (gm.length !== 2) continue;
    const other = gm.find((m) => m.user_id !== userId);
    if (!other) continue;
    const key = other.user_id ?? other.email ?? `${g.id}-${other.id}`;
    if (!personFriendGroup.has(key)) {
      personFriendGroup.set(key, {
        groupId: g.id,
        members: gm.map((m) => ({ id: m.id, user_id: m.user_id, display_name: m.display_name })),
      });
    }
  }

  const groupsWithBalance = (groups ?? []).map((g) => {
    const groupSplits = splitByGroup.get(g.id) ?? [];
    const groupMembers = memberByGroup.get(g.id) ?? [];
    const myMember = myMemberByGroupId.get(g.id) ?? null;
    const memberByUserId = new Map(
      groupMembers.filter((m) => m.user_id).map((m) => [m.user_id!, m.id])
    );
    const groupMemberIdSet = new Set(groupMembers.map((m) => m.id));

    if (groupSplits.length === 0) {
      const lastActivityAt = g.created_at;
      return {
        id: g.id,
        name: g.name,
        groupType: (g as { group_type?: string }).group_type ?? "other",
        imageUrl: (g as { image_url?: string | null }).image_url ?? null,
        memberCount: groupMembers.length,
        myBalance: 0 as number | null,
        myBalances: [] as { currency: string; amount: number }[],
        _nativeMyBalances: [] as { currency: string; amount: number }[],
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
        payerMemberId && groupMemberIdSet.has(payerMemberId)
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

    const owedAgg = new Map<string, { member_id: string; amount: number; currency: string }>();
    for (const s of groupSplits) {
      for (const sh of sharesBySplitId.get(s.id) ?? []) {
        const cur = splitCurrencyById.get(sh.split_transaction_id) ?? "USD";
        const key = `${sh.split_transaction_id}:${sh.member_id}`;
        const existing = owedAgg.get(key);
        if (existing) {
          existing.amount += Number(sh.amount);
        } else {
          owedAgg.set(key, { member_id: sh.member_id, amount: Number(sh.amount), currency: cur });
        }
      }
    }
    const owedRows = Array.from(owedAgg.values());

    const groupSettlements = settlementsByGroup.get(g.id) ?? [];
    const balanceSettlements = swGroupIds.has(g.id)
      ? groupSettlements.filter((s) => (s as { method?: string }).method !== "splitwise")
      : groupSettlements;
    const paidSettlements = balanceSettlements.map((s) => ({
      payer_member_id: s.payer_member_id,
      amount: Number(s.amount),
      currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
    }));
    const receivedSettlements = balanceSettlements.map((s) => ({
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

    // For SW groups, compute balance from Coconut-native expenses only (source != 'splitwise').
    // This delta is merged with the SW cached group balance in the overlay block below
    // so that manually-added expenses are reflected without double-counting imported ones.
    let _nativeMyBalances: { currency: string; amount: number }[] = [];
    if (hasSwCache && swGroupIds.has(g.id) && myMember) {
      const nativeSplits = groupSplits.filter((s) => (s as { source?: string | null }).source !== "splitwise");
      if (nativeSplits.length > 0) {
        const nativePaidRows: typeof paidRows = [];
        const nativeOwedAgg = new Map<string, { member_id: string; amount: number; currency: string }>();
        for (const s of nativeSplits) {
          const sShares = sharesBySplitId.get(s.id) ?? [];
          if (sShares.length === 0) continue;
          const sWithPayer = s as { payer_member_id?: string | null };
          const payerId = sWithPayer.payer_member_id;
          const nMemberId =
            payerId && groupMemberIdSet.has(payerId)
              ? payerId
              : (() => {
                  const tid = s.transaction_id as string | null | undefined;
                  const oid = tid ? txOwnerById.get(tid) : undefined;
                  return oid ? memberByUserId.get(oid) : null;
                })();
          if (nMemberId) {
            const amt = paidAmountFromSplitRow(
              s as { transactions?: unknown; amount?: number | string | null }
            );
            if (amt > 0) {
              nativePaidRows.push({
                member_id: nMemberId,
                amount: amt,
                currency: normalizeSplitCurrency((s as { iso_currency_code?: string | null }).iso_currency_code),
              });
            }
          }
          const cur = splitCurrencyById.get(s.id) ?? "USD";
          for (const sh of sShares) {
            const key = `${s.id}:${sh.member_id}`;
            const existing = nativeOwedAgg.get(key);
            if (existing) {
              existing.amount += Number(sh.amount);
            } else {
              nativeOwedAgg.set(key, { member_id: sh.member_id, amount: Number(sh.amount), currency: cur });
            }
          }
        }
        const nativeOwedRows = Array.from(nativeOwedAgg.values());
        const nativeSettlements = groupSettlements.filter(
          (st) => (st as { method?: string }).method !== "splitwise"
        );
        const nativePaidSett = nativeSettlements.map((st) => ({
          payer_member_id: st.payer_member_id,
          amount: Number(st.amount),
          currency: normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code),
        }));
        const nativeRcvdSett = nativeSettlements.map((st) => ({
          receiver_member_id: st.receiver_member_id,
          amount: Number(st.amount),
          currency: normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code),
        }));
        if (nativePaidRows.length > 0 || nativeOwedRows.length > 0 || nativeSettlements.length > 0) {
          const nativeBals = computeBalancesByCurrency(nativePaidRows, nativeOwedRows, nativePaidSett, nativeRcvdSett);
          for (const [cur, balMap] of nativeBals) {
            const t = balMap.get(myMember.id)?.total ?? 0;
            if (Math.abs(t) >= BALANCE_EPS) {
              _nativeMyBalances.push({ currency: cur, amount: Math.round(t * 100) / 100 });
            }
          }
        }
      }
    }

    // Compute correct PAIRWISE balances between me and each other member.
    // For each expense: if I paid, they owe me their share; if they paid, I owe them my share.
    // For SW groups with cached balances, only process Coconut-native expenses
    // (source != 'splitwise') to avoid double-counting with the SW cache overlay.
    {
      const isSw = hasSwCache && swGroupIds.has(g.id);
      const pairwiseRan = !!myMember;

      if (pairwiseRan) {
        const groupMemberById = new Map(groupMembers.map((m) => [m.id, m]));
        const groupMemberIds = new Set(groupMembers.map((m) => m.id));

        const pairwiseSplits = isSw
          ? groupSplits.filter((s) => (s as { source?: string | null }).source !== "splitwise")
          : groupSplits;

        // Process each split ONCE — O(splits × avg_shares) instead of O(members × splits)
        for (const s of pairwiseSplits) {
          const cur = splitCurrencyById.get(s.id) ?? "USD";
          const sWithPayer = s as { payer_member_id?: string | null };
          const pid = sWithPayer.payer_member_id && groupMemberIds.has(sWithPayer.payer_member_id)
            ? sWithPayer.payer_member_id
            : (() => {
                const tid = s.transaction_id as string | null | undefined;
                const oid = tid ? txOwnerById.get(tid) : undefined;
                return oid ? memberByUserId.get(oid) ?? null : null;
              })();
          if (!pid) continue;

          const shares = sharesBySplitId.get(s.id) ?? [];

          if (pid === myMember!.id) {
            for (const sh of shares) {
              if (sh.member_id === myMember!.id) continue;
              const m = groupMemberById.get(sh.member_id);
              if (!m || m.user_id === userId) continue;
              const theirShare = Number(sh.amount);
              if (theirShare > 0) {
                const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
                addPersonCurrency(personBalances, key, m.display_name, cur, theirShare);
              }
            }
          } else {
            const m = groupMemberById.get(pid);
            if (m && m.user_id !== userId) {
              const myShareRow = shares.find((sh) => sh.member_id === myMember!.id);
              if (myShareRow) {
                const myShare = Number(myShareRow.amount);
                if (myShare > 0) {
                  const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
                  addPersonCurrency(personBalances, key, m.display_name, cur, -myShare);
                }
              }
            }
          }
        }

        // Process settlements — skip for SW groups (SW cache overlay handles them)
        if (!isSw) {
          for (const st of groupSettlements) {
            const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
            const amt = Number(st.amount);
            if (st.payer_member_id === myMember!.id) {
              const m = groupMemberById.get(st.receiver_member_id);
              if (m && m.user_id !== userId) {
                const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
                addPersonCurrency(personBalances, key, m.display_name, cur, amt);
              }
            } else if (st.receiver_member_id === myMember!.id) {
              const m = groupMemberById.get(st.payer_member_id);
              if (m && m.user_id !== userId) {
                const key = m.user_id ?? m.email ?? `${g.id}-${m.id}`;
                addPersonCurrency(personBalances, key, m.display_name, cur, -amt);
              }
            }
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
      imageUrl: (g as { image_url?: string | null }).image_url ?? null,
      memberCount: groupMembers.length,
      myBalance,
      myBalances,
      _nativeMyBalances,
      lastActivityAt,
    };
  });

  // Background: refresh cached_group_balances from Splitwise so settled groups
  // don't show stale pre-settlement debt on the NEXT request.
  {
    const swTokenEnc = (swTokenRow as Record<string, unknown> | null)?.access_token as string | undefined;
    if (swTokenEnc) {
      void (async () => {
        try {
          const swToken = decryptToken(swTokenEnc);
          const swGroups = await getSwGroups(swToken);
          const swMe = await (async () => {
            for (const g of swGroups) {
              for (const m of g.members) {
                const match = (members ?? []).find(
                  (cm) => cm.email && cm.email.toLowerCase() === m.email?.toLowerCase()
                );
                if (match?.user_id === userId) return m;
              }
            }
            return null;
          })();
          if (!swMe) return;

          type SwBalance = { currency_code: string; amount: string };
          type CachedGroupBalance = { external_id: string; balances: SwBalance[] };
          const freshCache: CachedGroupBalance[] = swGroups.map((g) => {
            const byCur = new Map<string, number>();
            for (const d of g.simplified_debts) {
              const cur = d.currency_code ?? "USD";
              const amt = parseFloat(d.amount);
              if (d.to === swMe.id) byCur.set(cur, (byCur.get(cur) ?? 0) + amt);
              if (d.from === swMe.id) byCur.set(cur, (byCur.get(cur) ?? 0) - amt);
            }
            return {
              external_id: String(g.id),
              balances: [...byCur.entries()].map(([currency_code, a]) => ({
                currency_code,
                amount: a.toFixed(2),
              })),
            };
          });

          await getSupabaseAdmin()
            .from("splitwise_tokens")
            .update({ cached_group_balances: freshCache } as Record<string, unknown>)
            .eq("clerk_user_id", userId);
        } catch {
          // non-critical background refresh; swallow
        }
      })();
    }
  }

  // Use cached Splitwise balances (authoritative) instead of recalculated ones.
  // Splitwise's balance engine handles multi-payer, debt simplification, etc. correctly.
  {
    const tokenRow = swTokenRow;

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

      // Build per-person local settlement deltas (Coconut settlements not yet reflected in Splitwise cache).
      // These must be subtracted from the cached balance so "mark as paid" works immediately.
      // IMPORTANT: only include SW groups — non-SW settlements are already in the pairwise section.
      const localSettlementDeltas = new Map<string, Map<string, number>>();
      for (const m of members ?? []) {
        if (m.user_id === userId || !m.email) continue;
        if (!swGroupIds.has(m.group_id)) continue;
        const myMember = myMemberByGroupId.get(m.group_id) ?? null;
        if (!myMember) continue;
        const gSettlements = (settlementsByGroup.get(m.group_id) ?? []).filter(
          (s) => (s as { method?: string }).method !== "splitwise"
        );
        for (const st of gSettlements) {
          const cur = normalizeSplitCurrency((st as { iso_currency_code?: string | null }).iso_currency_code);
          const amt = Number(st.amount);
          const personKey = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
          if (!localSettlementDeltas.has(personKey)) localSettlementDeltas.set(personKey, new Map());
          const pMap = localSettlementDeltas.get(personKey)!;
          if (st.payer_member_id === m.id && st.receiver_member_id === myMember.id) {
            // They paid me → they owe me less → subtract from cached balance
            pMap.set(cur, (pMap.get(cur) ?? 0) - amt);
          } else if (st.payer_member_id === myMember.id && st.receiver_member_id === m.id) {
            // I paid them → I owe them less → add to cached balance
            pMap.set(cur, (pMap.get(cur) ?? 0) + amt);
          }
        }
      }

      // Merge cached Splitwise balances into existing pairwise balances (not replace).
      // The pairwise loop above already computed Coconut-native group balances;
      // the SW cache covers SW-imported groups. Adding them gives the true total.
      for (const cf of cached) {
        if (!cf || typeof cf !== "object" || !Array.isArray(cf.balance)) continue;
        const email = (cf.email ?? "").toLowerCase().trim();
        const match = memberEmailToKey.get(email);
        if (!match) continue;
        const existing = personBalances.get(match.key) ?? { displayName: match.displayName, byCurrency: new Map() };
        existing.displayName = match.displayName;
        for (const b of cf.balance) {
          const amt = parseFloat(b.amount);
          if (!Number.isFinite(amt) || Math.abs(amt) < BALANCE_EPS) continue;
          const cur = normalizeSplitCurrency(b.currency_code);
          const prev = existing.byCurrency.get(cur) ?? 0;
          const merged = Math.round((prev + amt) * 100) / 100;
          if (Math.abs(merged) < BALANCE_EPS) existing.byCurrency.delete(cur);
          else existing.byCurrency.set(cur, merged);
        }
        // Apply local Coconut settlements on top of cached Splitwise balance
        const deltas = localSettlementDeltas.get(match.key);
        if (deltas) {
          for (const [cur, delta] of deltas) {
            const current = existing.byCurrency.get(cur) ?? 0;
            const adjusted = Math.round((current + delta) * 100) / 100;
            if (Math.abs(adjusted) < BALANCE_EPS) existing.byCurrency.delete(cur);
            else existing.byCurrency.set(cur, adjusted);
          }
        }
        personBalances.set(match.key, existing);
      }

      // For members ONLY in Splitwise groups who are NOT in the cache,
      // their Splitwise balance is $0 — zero out the bad recalculated value.

      // Pre-index: email → group IDs (for non-current-user members)
      const emailToGroupIds = new Map<string, string[]>();
      for (const mm of members ?? []) {
        if (mm.user_id === userId || !mm.email) continue;
        const email = mm.email.toLowerCase().trim();
        const list = emailToGroupIds.get(email) ?? [];
        if (!list.includes(mm.group_id)) list.push(mm.group_id);
        emailToGroupIds.set(email, list);
      }

      for (const m of members ?? []) {
        if (m.user_id === userId || !m.email) continue;
        const email = m.email.toLowerCase().trim();
        if (cachedEmailSet.has(email)) continue; // already handled above
        // Check if this member ONLY appears in Splitwise groups
        const memberGroups = emailToGroupIds.get(email) ?? [];
        const allSw = memberGroups.every((gid) => swGroupIds.has(gid));
        if (allSw) {
          const key = m.user_id ?? m.email ?? `${m.group_id}-${m.id}`;
          personBalances.set(key, { displayName: m.display_name, byCurrency: new Map() });
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
        personBalances.set(key, { displayName: name, byCurrency: newByCurrency });
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
      const groupById = new Map((groups ?? []).map((gr) => [gr.id, gr]));

      for (const g of groupsWithBalance) {
        const row = groupById.get(g.id);
        if (row?.source !== "splitwise" || !row.external_id) continue;
        const cachedBals = groupCacheMap.get(row.external_id);
        if (!cachedBals) continue;

        const swByCurrency = new Map<string, number>();
        for (const b of cachedBals) {
          const cur = normalizeSplitCurrency(b.currency_code);
          const amt = Math.round(parseFloat(b.amount) * 100) / 100;
          if (Number.isFinite(amt) && Math.abs(amt) >= BALANCE_EPS) {
            swByCurrency.set(cur, (swByCurrency.get(cur) ?? 0) + amt);
          }
        }

        // Merge Coconut-native expense deltas (source != 'splitwise') into SW cached balance
        const nativeBals = (g as typeof g & { _nativeMyBalances?: { currency: string; amount: number }[] })._nativeMyBalances ?? [];
        for (const nb of nativeBals) {
          swByCurrency.set(nb.currency, (swByCurrency.get(nb.currency) ?? 0) + nb.amount);
        }

        const mergedBalances = [...swByCurrency.entries()]
          .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
          .filter((b) => Math.abs(b.amount) >= BALANCE_EPS);
        mergedBalances.sort((a, b) => a.currency.localeCompare(b.currency));

        g.myBalances = mergedBalances;
        g.myBalance =
          mergedBalances.length === 1 ? mergedBalances[0].amount : mergedBalances.length === 0 ? 0 : null;
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

  // Deduplicate person entries that share the same display name but ended up
  // with different keys (e.g., one group member has email, another doesn't).
  // Merge their per-currency balances and keep the first key encountered.
  {
    const byName = new Map<string, { canonicalKey: string; agg: PersonAgg }>();
    for (const [key, agg] of personBalances) {
      const normName = agg.displayName.trim().toLowerCase();
      const existing = byName.get(normName);
      if (!existing) {
        byName.set(normName, { canonicalKey: key, agg: { displayName: agg.displayName, byCurrency: new Map(agg.byCurrency) } });
      } else {
        for (const [cur, amt] of agg.byCurrency) {
          const prev = existing.agg.byCurrency.get(cur) ?? 0;
          const merged = Math.round((prev + amt) * 100) / 100;
          if (Math.abs(merged) < BALANCE_EPS) existing.agg.byCurrency.delete(cur);
          else existing.agg.byCurrency.set(cur, merged);
        }
      }
    }
    personBalances.clear();
    for (const { canonicalKey, agg } of byName.values()) {
      personBalances.set(canonicalKey, agg);
    }
  }

  let friends = Array.from(personBalances.entries())
    .map(([key, v]) => friendRowFromAgg(key, v, personFriendGroup.get(key)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Hide 1:1 groups from the group list — their balances already appear in the
  // friends list via pairwise computation. This covers both explicit "friend"
  // groupType AND 2-member groups whose name matches a known person.
  const allPersonNames = new Set(
    [...personBalances.values()].map((v) => v.displayName.trim().toLowerCase())
  );
  const nonFriendGroups = groupsWithBalance.filter((g) => {
    if (g.groupType === "friend") return false;
    if (g.memberCount <= 2 && allPersonNames.has(g.name.trim().toLowerCase())) return false;
    return true;
  });
  let groupsOut = nonFriendGroups;

  if (showAll) {
    // Return everything (incl. settled and 1:1 friend groups) — no filtering.
    groupsOut = groupsWithBalance;
  } else {
    // Splitwise-style: only show friends with non-zero pairwise balance.
    friends = friends.filter((f) => f.balances.length > 0);
    groupsOut = nonFriendGroups.filter((g) => (g.myBalances?.length ?? 0) > 0);
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
    hasSwCache,
    swGroupCount: swGroupIds.size,
  });

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
