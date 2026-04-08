export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import { getSuggestedSettlements } from "@/lib/split-balances";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getUserId } from "@/lib/auth";
import { getClerkUserPhotos } from "@/lib/clerk-user-lookup";
import {
  merchantLabelFromSplitRow,
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

const BALANCE_EPS = 0.005;

// Cache to prevent repeated Clerk email-enrichment calls for the same member within 5 minutes
const _ownerEmailCache = new Map<string, number>();
const OWNER_EMAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const db = getSupabase();

    // Fetch group and member access check in parallel — avoids canAccessGroup's redundant re-query
    let group: Record<string, unknown> | null = null;
    const [groupResult, memberResult] = await Promise.all([
      db.from("groups").select("id, name, owner_id, created_at, group_type, invite_token, archived_at, image_url, source, external_id").eq("id", id).single(),
      db.from("group_members").select("id").eq("group_id", id).eq("user_id", userId).maybeSingle(),
    ]);
    if (groupResult.error?.code === "42703") {
      const fallback = await db.from("groups").select("id, name, owner_id, created_at, group_type, invite_token, image_url, source, external_id").eq("id", id).single();
      group = fallback.data;
    } else {
      group = groupResult.error ? null : groupResult.data;
    }
    if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isOwner = group.owner_id === userId;
    if (!isOwner && !memberResult.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Lazy-migrate data URI to Supabase Storage if still using inline base64
    if ((group as Record<string, unknown>).image_url && typeof (group as Record<string, unknown>).image_url === "string" && ((group as Record<string, unknown>).image_url as string).startsWith("data:")) {
      void (async () => {
        try {
          const raw = (group as Record<string, unknown>).image_url as string;
          const match = raw.match(/^data:(image\/\w+);base64,(.+)$/);
          if (!match) return;
          const contentType = match[1];
          const base64Data = match[2];
          const ext = contentType === "image/png" ? "png" : "jpg";
          const buffer = Buffer.from(base64Data, "base64");
          const storagePath = `${id}.${ext}`;
          const adminDb = getSupabaseAdmin();
          const { error: upErr } = await adminDb.storage.from("group-icons").upload(storagePath, buffer, { contentType, upsert: true });
          if (upErr) return;
          const { data: urlData } = adminDb.storage.from("group-icons").getPublicUrl(storagePath);
          await adminDb.from("groups").update({ image_url: urlData.publicUrl }).eq("id", id);
          console.log("[groups/id] migrated data URI to storage for", id);
        } catch { /* best effort */ }
      })();
    }

    const { invite_token, ...groupWithoutToken } = group as typeof group & { invite_token?: string };
    const maskedGroup = { ...groupWithoutToken, invite_token: invite_token ?? null };

    // Stage 1: parallel fetch of members, splits, and settlements
    const [membersResult, splitsResult, settlementsResult] = await Promise.all([
      db
        .from("group_members")
        .select("id, user_id, email, display_name, venmo_username, cashapp_cashtag, paypal_username")
        .eq("group_id", id),
      db
        .from("split_transactions")
        .select(`
          id, transaction_id, created_by, created_at, payer_member_id, amount, description,
          iso_currency_code, receipt_url, category,
          transactions(merchant_name, raw_name, amount, date, primary_category)
        `)
        .eq("group_id", id)
        .order("created_at", { ascending: false }),
      db
        .from("settlements")
        .select("payer_member_id, receiver_member_id, amount, method, status, iso_currency_code")
        .eq("group_id", id)
        .eq("status", "completed"),
    ]);

    let { data: members } = membersResult;
    const { data: splitsRaw } = splitsResult;
    const { data: settlements } = settlementsResult;

    // Owner email backfill (fire-and-forget DB write, sync member update)
    const ownerId = group.owner_id as string;
    const ownerMember = (members ?? []).find((m) => m.user_id === ownerId && !m.email);
    const now = Date.now();
    const lastAttempt = ownerMember ? _ownerEmailCache.get(ownerMember.id) : undefined;
    const clerkCacheHit = lastAttempt !== undefined && now - lastAttempt < OWNER_EMAIL_CACHE_TTL_MS;
    if (ownerMember && ownerId && !clerkCacheHit) {
      _ownerEmailCache.set(ownerMember.id, now);
      try {
        const client = await clerkClient();
        const ownerUser = await client.users.getUser(ownerId);
        const ownerEmail = ownerUser?.primaryEmailAddress?.emailAddress ?? null;
        if (ownerEmail) {
          void db.from("group_members").update({ email: ownerEmail }).eq("id", ownerMember.id);
          members = (members ?? []).map((m) =>
            m.id === ownerMember.id ? { ...m, email: ownerEmail } : m
          );
        }
      } catch {
        // Ignore Clerk errors (e.g. no secret key in dev)
      }
    }

    // Deduplicate members that share the same non-null user_id.
    {
      const seen = new Map<string, number>();
      const deduped: typeof members = [];
      for (const m of members ?? []) {
        if (!m.user_id) { deduped.push(m); continue; }
        const prev = seen.get(m.user_id);
        if (prev == null) {
          seen.set(m.user_id, deduped.length);
          deduped.push(m);
        } else {
          const kept = deduped[prev];
          if (kept.display_name === "You" && m.display_name !== "You") {
            kept.display_name = m.display_name;
          }
          kept.email = kept.email || m.email;
          kept.venmo_username = kept.venmo_username || m.venmo_username;
          kept.cashapp_cashtag = kept.cashapp_cashtag || m.cashapp_cashtag;
          kept.paypal_username = kept.paypal_username || m.paypal_username;
        }
      }
      members = deduped;
    }

    const seenTxIds = new Set<string>();
    const splits = (splitsRaw ?? []).filter((s) => {
      const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
      if (seenTxIds.has(k)) return false;
      seenTxIds.add(k);
      return true;
    });

    // Stage 2: parallel fetch of shares, tx owners, and Clerk photos
    const splitIdList = splits.map((s) => s.id);
    const txIds = splits.map((s) => s.transaction_id).filter(Boolean);
    const memberUserIds = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];

    async function paginate<T>(
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

    const BATCH = 200;
    const sharesBatchPromises: Promise<{ split_transaction_id: string; member_id: string; amount: number }[]>[] = [];
    for (let i = 0; i < splitIdList.length; i += BATCH) {
      const batch = splitIdList.slice(i, i + BATCH);
      sharesBatchPromises.push(
        paginate(() =>
          db.from("split_shares")
            .select("split_transaction_id, member_id, amount")
            .in("split_transaction_id", batch)
        )
      );
    }
    const txBatchPromises: Promise<{ id: string; clerk_user_id: string }[]>[] = [];
    for (let i = 0; i < txIds.length; i += BATCH) {
      const batch = txIds.slice(i, i + BATCH);
      txBatchPromises.push(
        paginate(() =>
          db.from("transactions")
            .select("id, clerk_user_id")
            .in("id", batch)
        )
      );
    }
    const isSplitwiseGroup =
      (group as { source?: string }).source === "splitwise" &&
      (group as { external_id?: string }).external_id;

    const [sharesBatchResults, txBatchResults, photoMap, splitwiseTokenRow] = await Promise.all([
      splitIdList.length > 0 ? Promise.all(sharesBatchPromises) : Promise.resolve([] as { split_transaction_id: string; member_id: string; amount: number }[][]),
      txIds.length > 0 ? Promise.all(txBatchPromises) : Promise.resolve([] as { id: string; clerk_user_id: string }[][]),
      getClerkUserPhotos(memberUserIds),
      isSplitwiseGroup
        ? Promise.resolve(
            getSupabaseAdmin()
              .from("splitwise_tokens")
              .select("cached_group_balances")
              .eq("clerk_user_id", userId)
              .maybeSingle()
          ).then((r) => r.data).catch(() => null)
        : Promise.resolve(null),
    ]);

    const shares = sharesBatchResults.flat();
    const txRows = txBatchResults.flat();

    members = (members ?? []).map((m) => ({
      ...m,
      image_url: (m.user_id && photoMap.get(m.user_id)) || null,
    }));

    if (splits.length === 0) {
      return NextResponse.json({
        ...maskedGroup,
        group: maskedGroup,
        isOwner,
        archivedAt: (group as { archived_at?: string | null }).archived_at ?? null,
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
        mySpend: 0,
        mySpendByCurrency: [],
        categoryBreakdown: [],
      });
    }

    const txOwnerById = new Map((txRows ?? []).map((t: { id: string; clerk_user_id: string }) => [t.id, t.clerk_user_id]));
    const memberByUserId = new Map(
      (members ?? []).filter((m) => m.user_id).map((m) => [m.user_id, m.id])
    );

    // Pre-index shares by split_transaction_id for O(1) lookups
    const sharesBySplitId = new Map<string, NonNullable<typeof shares>>();
    for (const sh of shares ?? []) {
      const list = sharesBySplitId.get(sh.split_transaction_id);
      if (list) list.push(sh);
      else sharesBySplitId.set(sh.split_transaction_id, [sh]);
    }

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
      const shareList = sharesBySplitId.get(s.id) ?? [];
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
        receiptUrl: (s as { receipt_url?: string | null }).receipt_url ?? null,
      };
    });

    const archivedAt = (group as { archived_at?: string | null }).archived_at ?? null;

    // Override balances + suggestions for Splitwise groups with authoritative simplified_debts.
    let finalBalances = balancesFlat;
    let finalSuggestions = suggestions;
    if (isSplitwiseGroup) {
      try {
        const tokenRow = splitwiseTokenRow;

        type CachedGroupBalance = {
          external_id: string;
          balances: { currency_code: string; amount: string }[];
        };
        const cachedGroups = (tokenRow as Record<string, unknown> | null)
          ?.cached_group_balances as CachedGroupBalance[] | null;
        const extId = (group as { external_id: string }).external_id;
        const cachedBals = cachedGroups?.find((g) => g.external_id === extId)?.balances;

        if (cachedBals && cachedBals.length > 0) {
          const myMember = (members ?? []).find((m) => m.user_id === userId);
          const cachedMyByCurrency = new Map(
            cachedBals.map((b) => [
              normalizeSplitCurrency(b.currency_code),
              Math.round(parseFloat(b.amount) * 100) / 100,
            ])
          );
          if (myMember) {
            for (const b of finalBalances) {
              if (b.memberId !== myMember.id) continue;
              const cached = cachedMyByCurrency.get(b.currency);
              if (cached !== undefined) b.total = cached;
            }

            // Rebuild suggestions from the authoritative cached balance so the
            // "settle up" section matches Splitwise instead of showing amounts
            // derived from incomplete imported data.
            const newSuggestions: typeof finalSuggestions = [];
            for (const [cur, amt] of cachedMyByCurrency) {
              if (Math.abs(amt) < BALANCE_EPS) continue;
              const existingForCur = suggestions.find((s) => s.currency === cur);
              if (amt < 0) {
                const toId = existingForCur?.toMemberId
                  ?? (members ?? []).find((m) => m.id !== myMember.id)?.id;
                if (toId) {
                  newSuggestions.push({ currency: cur, fromMemberId: myMember.id, toMemberId: toId, amount: Math.abs(amt) });
                }
              } else {
                const fromId = existingForCur?.fromMemberId
                  ?? (members ?? []).find((m) => m.id !== myMember.id)?.id;
                if (fromId) {
                  newSuggestions.push({ currency: cur, fromMemberId: fromId, toMemberId: myMember.id, amount: amt });
                }
              }
            }
            finalSuggestions = newSuggestions;
          }
        }
      } catch (err) {
        console.warn("[groups/id] cached group balance overlay failed:", err);
      }
    }

    // Compute per-user spending summary: total + category breakdown
    const myMemberId = (members ?? []).find((m) => m.user_id === userId)?.id;
    const mySpendByCurrency = new Map<string, number>();
    const catSpend = new Map<string, number>();

    if (myMemberId) {
      const splitCatById = new Map(
        splits.map((s) => {
          const cat =
            (s as { category?: string | null }).category ||
            ((s as { transactions?: { primary_category?: string | null } }).transactions
              ?.primary_category) ||
            null;
          return [s.id, cat];
        })
      );

      for (const sh of shares ?? []) {
        if (sh.member_id !== myMemberId) continue;
        const amt = Math.round(Number(sh.amount) * 100) / 100;
        if (amt <= 0) continue;
        const cur = splitCurrencyById.get(sh.split_transaction_id) ?? "USD";
        mySpendByCurrency.set(cur, (mySpendByCurrency.get(cur) ?? 0) + amt);
        const cat = splitCatById.get(sh.split_transaction_id) ?? "Other";
        catSpend.set(cat, (catSpend.get(cat) ?? 0) + amt);
      }
    }

    const mySpendArr = [...mySpendByCurrency.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    const mySpend =
      mySpendArr.length === 1 ? mySpendArr[0].amount : mySpendArr.length === 0 ? 0 : null;

    const catTotal = [...catSpend.values()].reduce((s, v) => s + v, 0);
    const categoryBreakdown = [...catSpend.entries()]
      .map(([category, amount]) => ({
        category,
        amount: Math.round(amount * 100) / 100,
        percent: catTotal > 0 ? Math.round((amount / catTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      ...maskedGroup,
      group: maskedGroup,
      isOwner,
      archivedAt,
      members: members ?? [],
      activity,
      balances: finalBalances,
      suggestions: finalSuggestions.map((s) => ({
        ...s,
        fromMember: memberMap.get(s.fromMemberId),
        toMember: memberMap.get(s.toMemberId),
      })),
      totalSpend,
      totalSpendByCurrency,
      mySpend,
      mySpendByCurrency: mySpendArr,
      categoryBreakdown,
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
  const db = getSupabase();
  // Single query — owner check is sufficient for PATCH (members can't archive)
  const { data: row, error: loadErr } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (loadErr || !row || row.owner_id !== userId) {
    return NextResponse.json({ error: "Only the group owner can update this group" }, { status: 403 });
  }

  let body: { archived?: boolean; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: { archived_at?: string | null; name?: string } = {};

  if ("name" in body) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: "name must not be empty" }, { status: 400 });
    }
    if (trimmed.length > 100) {
      return NextResponse.json({ error: "name must be at most 100 characters" }, { status: 400 });
    }
    updates.name = trimmed;
  }

  if (body.archived === true) {
    updates.archived_at = new Date().toISOString();
  } else if (body.archived === false) {
    updates.archived_at = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Provide name and/or set archived to true or false" },
      { status: 400 }
    );
  }

  const { error: up } = await db.from("groups").update(updates).eq("id", id);
  if (up) return NextResponse.json({ error: up.message }, { status: 500 });

  const response: Record<string, unknown> = { ok: true };
  if ("name" in body && typeof body.name === "string") {
    response.name = updates.name;
  }
  if (body.archived === true) {
    response.archivedAt = updates.archived_at;
  } else if (body.archived === false) {
    response.archivedAt = null;
  }

  return NextResponse.json(response);
}
