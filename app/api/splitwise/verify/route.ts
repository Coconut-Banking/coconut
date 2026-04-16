export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup } from "@/lib/splitwise";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import {
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";
import { getMirrorGroupId, isShadowWriteEnabled } from "@/lib/splitwise-shadow";

interface MemberDrift {
  memberName: string;
  memberId: string;
  currency: string;
  coconutBalance: number;
  splitwiseBalance: number;
  diff: number;
}

interface GroupResult {
  groupName: string;
  coconutGroupId: string;
  mirrorSwGroupId: number | null;
  realSwGroupId: number | null;
  coconutExpenses: number;
  mirrorExpenses: number;
  coconutSettlements: number;
  ok: boolean;
  members: MemberDrift[];
  error?: string;
}

/**
 * GET /api/splitwise/verify
 *
 * Compare Coconut-native balances against the Splitwise MIRROR group balances.
 * For each group with a mirror, computes Coconut balances from native-only
 * splits + native-only settlements, then compares against the mirror group's
 * simplified_debts from the Splitwise API.
 *
 * Returns per-group, per-member, per-currency drift.
 * If everything matches, `ok` is true and all group drifts are empty.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isShadowWriteEnabled()) {
    return NextResponse.json({ error: "SPLITWISE_SHADOW_WRITE is not enabled" }, { status: 400 });
  }

  const db = getSupabase();

  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token, shadow_mirror_map")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json({ error: "Connect Splitwise first" }, { status: 400 });
  }

  const token = decryptToken(tokenRow.access_token);

  // Get the mirror map to find all groups with mirrors
  const mirrorMap: Record<string, number> = (
    tokenRow as Record<string, unknown>
  ).shadow_mirror_map as Record<string, number> ?? {};

  const coconutGroupIds = Object.keys(mirrorMap);
  if (coconutGroupIds.length === 0) {
    return NextResponse.json({
      ok: true,
      groups: [],
      message: "No mirror groups found. Add an expense to a group to trigger mirror creation.",
    });
  }

  // Load all coconut groups with mirrors
  const { data: groups } = await db
    .from("groups")
    .select("id, name, external_id, source")
    .in("id", coconutGroupIds);

  if (!groups || groups.length === 0) {
    return NextResponse.json({ ok: true, groups: [], message: "No groups found" });
  }

  const results: GroupResult[] = [];

  for (const coconutGroup of groups) {
    const mirrorSwGroupId = mirrorMap[coconutGroup.id];
    if (!mirrorSwGroupId) continue;

    const isSwImported =
      (coconutGroup as { source?: string }).source === "splitwise" &&
      coconutGroup.external_id;

    try {
      const [swMirror, membersResult, splitsResult, settlementsResult, sharesResult] =
        await Promise.all([
          getGroup(token, mirrorSwGroupId),
          db
            .from("group_members")
            .select("id, email, display_name, user_id")
            .eq("group_id", coconutGroup.id),
          db
            .from("split_transactions")
            .select(
              "id, transaction_id, payer_member_id, amount, iso_currency_code, source, transactions(amount)"
            )
            .eq("group_id", coconutGroup.id),
          db
            .from("settlements")
            .select("payer_member_id, receiver_member_id, amount, method, iso_currency_code")
            .eq("group_id", coconutGroup.id)
            .eq("status", "completed"),
          db
            .from("split_shares")
            .select("split_transaction_id, member_id, amount")
            .eq(
              "split_transaction_id",
              // dummy — overridden below
              "00000000-0000-0000-0000-000000000000"
            ),
        ]);

      const members = membersResult.data ?? [];
      const allSplits = splitsResult.data ?? [];
      const allSettlements = settlementsResult.data ?? [];

      // For SW-imported groups, only use native (non-imported) splits
      // The mirror has bootstrapped history + native dual-writes, so we compare
      // the full mirror against ONLY native Coconut data
      const nativeSplits = isSwImported
        ? allSplits.filter(
            (s) => (s as { source?: string | null }).source !== "splitwise"
          )
        : allSplits;

      // Deduplicate splits
      const seenKeys = new Set<string>();
      const dedupedSplits = nativeSplits.filter((s) => {
        const k = splitTransactionDedupeKey(
          s as { id: string; transaction_id?: string | null }
        );
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });

      // Fetch shares for deduped splits
      const splitIds = dedupedSplits.map((s) => s.id);
      const { data: shares } =
        splitIds.length > 0
          ? await db
              .from("split_shares")
              .select("split_transaction_id, member_id, amount")
              .in("split_transaction_id", splitIds)
          : { data: [] as { split_transaction_id: string; member_id: string; amount: number }[] };

      const sharesBySplit = new Map<string, typeof shares>();
      for (const sh of shares ?? []) {
        const arr = sharesBySplit.get(sh.split_transaction_id) ?? [];
        arr.push(sh);
        sharesBySplit.set(sh.split_transaction_id, arr);
      }

      // Build paid/owed rows from native splits
      const paidRows: { member_id: string; amount: number; currency: string }[] = [];
      const owedRows: { member_id: string; amount: number; currency: string }[] = [];

      for (const split of dedupedSplits) {
        const cur = normalizeSplitCurrency(split.iso_currency_code);
        const splitShares = sharesBySplit.get(split.id) ?? [];
        const paidAmt = Math.abs(
          paidAmountFromSplitRow(
            split as Parameters<typeof paidAmountFromSplitRow>[0]
          )
        );

        const payerId = (split.payer_member_id as string | null) ?? null;
        if (payerId && paidAmt > 0) {
          paidRows.push({ member_id: payerId, amount: paidAmt, currency: cur });
        }

        for (const sh of splitShares) {
          if (sh.amount > 0) {
            owedRows.push({ member_id: sh.member_id, amount: sh.amount, currency: cur });
          }
        }
      }

      // Filter settlements: for SW-imported groups, exclude imported SW settlements
      const nativeSettlements = isSwImported
        ? allSettlements.filter(
            (s) => (s as { method?: string }).method !== "splitwise"
          )
        : allSettlements;

      const paidSettlements = nativeSettlements.map((s) => ({
        payer_member_id: s.payer_member_id,
        amount: Number(s.amount),
        currency: normalizeSplitCurrency(s.iso_currency_code),
      }));
      const receivedSettlements = nativeSettlements.map((s) => ({
        receiver_member_id: s.receiver_member_id,
        amount: Number(s.amount),
        currency: normalizeSplitCurrency(s.iso_currency_code),
      }));

      const balanceMap = computeBalancesByCurrency(
        paidRows,
        owedRows,
        paidSettlements,
        receivedSettlements
      );

      // Parse Splitwise mirror simplified_debts into per-member net balances
      const swMemberById = new Map(swMirror.members.map((m) => [m.id, m]));
      const swBalByEmail = new Map<string, Map<string, number>>();

      for (const debt of swMirror.simplified_debts ?? []) {
        const cur = (debt.currency_code ?? "USD").toUpperCase();
        const amount = parseFloat(debt.amount);
        if (!Number.isFinite(amount) || amount === 0) continue;

        const fromM = swMemberById.get(debt.from);
        const toM = swMemberById.get(debt.to);
        if (!fromM || !toM) continue;

        const fromEmail = fromM.email?.trim().toLowerCase() ?? "";
        const toEmail = toM.email?.trim().toLowerCase() ?? "";

        if (fromEmail) {
          const m = swBalByEmail.get(fromEmail) ?? new Map();
          m.set(cur, (m.get(cur) ?? 0) - amount);
          swBalByEmail.set(fromEmail, m);
        }
        if (toEmail) {
          const m = swBalByEmail.get(toEmail) ?? new Map();
          m.set(cur, (m.get(cur) ?? 0) + amount);
          swBalByEmail.set(toEmail, m);
        }
      }

      // Count non-deleted mirror expenses
      const mirrorExpenseCount = ((swMirror as { expenses?: unknown[] }).expenses as unknown[] | undefined)?.length ?? 0;

      // Compare per-member per-currency
      const memberDrifts: MemberDrift[] = [];
      for (const member of members) {
        const email = member.email?.trim().toLowerCase();
        if (!email) continue;

        const swCurMap = swBalByEmail.get(email) ?? new Map();
        const allCurrencies = new Set([
          ...Array.from(balanceMap.keys()).filter((cur) =>
            balanceMap.get(cur)?.has(member.id)
          ),
          ...swCurMap.keys(),
        ]);

        for (const cur of allCurrencies) {
          const coconutBal = balanceMap.get(cur)?.get(member.id);
          const coconutTotal = coconutBal
            ? Math.round(coconutBal.total * 100) / 100
            : 0;
          const swTotal = Math.round((swCurMap.get(cur) ?? 0) * 100) / 100;
          const diff = Math.round((coconutTotal - swTotal) * 100) / 100;

          if (Math.abs(diff) > 0.01) {
            memberDrifts.push({
              memberName: member.display_name ?? email,
              memberId: member.id,
              currency: cur,
              coconutBalance: coconutTotal,
              splitwiseBalance: swTotal,
              diff,
            });
          }
        }
      }

      results.push({
        groupName: coconutGroup.name,
        coconutGroupId: coconutGroup.id,
        mirrorSwGroupId,
        realSwGroupId: coconutGroup.external_id
          ? Number(coconutGroup.external_id)
          : null,
        coconutExpenses: dedupedSplits.length,
        mirrorExpenses: mirrorExpenseCount,
        coconutSettlements: nativeSettlements.length,
        ok: memberDrifts.length === 0,
        members: memberDrifts,
      });
    } catch (e) {
      results.push({
        groupName: coconutGroup.name,
        coconutGroupId: coconutGroup.id,
        mirrorSwGroupId,
        realSwGroupId: coconutGroup.external_id
          ? Number(coconutGroup.external_id)
          : null,
        coconutExpenses: 0,
        mirrorExpenses: 0,
        coconutSettlements: 0,
        ok: false,
        members: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    ok: allOk,
    groupsChecked: results.length,
    groups: results,
  });
}
