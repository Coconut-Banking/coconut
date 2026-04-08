export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup, getFriends, type SplitwiseGroup } from "@/lib/splitwise";
import { computeBalancesByCurrency, normalizeSplitCurrency } from "@/lib/split-balances-currency";
import { getSuggestedSettlements } from "@/lib/split-balances";
import {
  paidAmountFromSplitRow,
  splitTransactionDedupeKey,
} from "@/lib/split-transaction-helpers";

interface Drift {
  groupName: string;
  coconutGroupId: string;
  swGroupId: number;
  currency: string;
  memberName: string;
  coconutBalance: number;
  splitwiseBalance: number;
  diff: number;
}

/**
 * GET /api/splitwise/verify
 *
 * Compare Coconut balances against Splitwise for every linked group.
 * Returns per-member, per-currency drift. If everything matches,
 * `drifts` is empty and `ok` is true.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json({ error: "Connect Splitwise first" }, { status: 400 });
  }

  const token = decryptToken(tokenRow.access_token);

  // Find all Coconut groups linked to Splitwise
  const { data: linkedGroups } = await db
    .from("groups")
    .select("id, name, external_id")
    .eq("source", "splitwise")
    .not("external_id", "is", null);

  if (!linkedGroups || linkedGroups.length === 0) {
    return NextResponse.json({ ok: true, drifts: [], message: "No linked Splitwise groups" });
  }

  const drifts: Drift[] = [];

  for (const coconutGroup of linkedGroups) {
    const swGroupId = Number(coconutGroup.external_id);

    try {
      // Fetch Splitwise group (has simplified_debts) and Coconut data in parallel
      const [swGroup, membersResult, splitsResult, settlementsResult] = await Promise.all([
        getGroup(token, swGroupId),
        db.from("group_members").select("id, email, display_name").eq("group_id", coconutGroup.id),
        db
          .from("split_transactions")
          .select(
            "id, transaction_id, payer_member_id, amount, iso_currency_code, transactions(amount)"
          )
          .eq("group_id", coconutGroup.id),
        db
          .from("settlements")
          .select("payer_member_id, receiver_member_id, amount, iso_currency_code")
          .eq("group_id", coconutGroup.id)
          .eq("status", "completed"),
      ]);

      const members = membersResult.data ?? [];
      const splits = splitsResult.data ?? [];
      const settlements = settlementsResult.data ?? [];

      // Deduplicate splits
      const seenKeys = new Set<string>();
      const dedupedSplits = splits.filter((s) => {
        const k = splitTransactionDedupeKey(s as { id: string; transaction_id?: string | null });
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });

      // Fetch shares for all splits
      const splitIds = dedupedSplits.map((s) => s.id);
      const { data: shares } = splitIds.length > 0
        ? await db.from("split_shares").select("split_transaction_id, member_id, amount").in("split_transaction_id", splitIds)
        : { data: [] as { split_transaction_id: string; member_id: string; amount: number }[] };

      // Build Coconut balance rows (same logic as groups/[id] route)
      const memberByUserId = new Map(members.map((m) => [m.id, m]));
      const sharesBySplit = new Map<string, typeof shares>();
      for (const sh of shares ?? []) {
        const arr = sharesBySplit.get(sh.split_transaction_id) ?? [];
        arr.push(sh);
        sharesBySplit.set(sh.split_transaction_id, arr);
      }

      const paidRows: { member_id: string; amount: number; currency: string }[] = [];
      const owedRows: { member_id: string; amount: number; currency: string }[] = [];

      for (const split of dedupedSplits) {
        const cur = normalizeSplitCurrency(split.iso_currency_code);
        const splitShares = sharesBySplit.get(split.id) ?? [];
        const paidAmt = Math.abs(paidAmountFromSplitRow(split as Parameters<typeof paidAmountFromSplitRow>[0]));

        // Payer
        const payerId = (split.payer_member_id as string | null) ?? null;
        if (payerId && paidAmt > 0) {
          paidRows.push({ member_id: payerId, amount: paidAmt, currency: cur });
        }

        // Owed shares
        for (const sh of splitShares) {
          if (sh.amount > 0) {
            owedRows.push({ member_id: sh.member_id, amount: sh.amount, currency: cur });
          }
        }
      }

      const paidSettlements = settlements.map((s) => ({
        payer_member_id: s.payer_member_id,
        amount: Number(s.amount),
        currency: normalizeSplitCurrency(s.iso_currency_code),
      }));
      const receivedSettlements = settlements.map((s) => ({
        receiver_member_id: s.receiver_member_id,
        amount: Number(s.amount),
        currency: normalizeSplitCurrency(s.iso_currency_code),
      }));

      const balanceMap = computeBalancesByCurrency(paidRows, owedRows, paidSettlements, receivedSettlements);

      // Build email → member mapping for comparing with Splitwise
      const emailToMember = new Map<string, { id: string; display_name: string }>();
      for (const m of members) {
        const email = m.email?.trim().toLowerCase();
        if (email) emailToMember.set(email, { id: m.id, display_name: m.display_name });
      }

      // Parse Splitwise simplified_debts into per-member balances
      // Splitwise simplified_debts: {from, to, amount, currency_code}
      // from owes to. Positive = from perspective of "to".
      const swBalanceByEmail = new Map<string, Map<string, number>>();
      const swMemberById = new Map(swGroup.members.map((m) => [m.id, m]));

      for (const debt of swGroup.simplified_debts ?? []) {
        const cur = (debt.currency_code ?? "USD").toUpperCase();
        const amount = parseFloat(debt.amount);
        if (!Number.isFinite(amount) || amount === 0) continue;

        const fromMember = swMemberById.get(debt.from);
        const toMember = swMemberById.get(debt.to);
        if (!fromMember || !toMember) continue;

        const fromEmail = fromMember.email?.trim().toLowerCase() ?? "";
        const toEmail = toMember.email?.trim().toLowerCase() ?? "";

        // "from" owes "to" → from has negative balance, to has positive
        if (fromEmail) {
          const curMap = swBalanceByEmail.get(fromEmail) ?? new Map();
          curMap.set(cur, (curMap.get(cur) ?? 0) - amount);
          swBalanceByEmail.set(fromEmail, curMap);
        }
        if (toEmail) {
          const curMap = swBalanceByEmail.get(toEmail) ?? new Map();
          curMap.set(cur, (curMap.get(cur) ?? 0) + amount);
          swBalanceByEmail.set(toEmail, curMap);
        }
      }

      // Compare: for each member/currency, check Coconut vs Splitwise
      for (const member of members) {
        const email = member.email?.trim().toLowerCase();
        if (!email) continue;

        const swCurMap = swBalanceByEmail.get(email) ?? new Map();
        const allCurrencies = new Set([
          ...Array.from(balanceMap.keys()).filter((cur) => balanceMap.get(cur)?.has(member.id)),
          ...swCurMap.keys(),
        ]);

        for (const cur of allCurrencies) {
          const coconutBal = balanceMap.get(cur)?.get(member.id);
          const coconutTotal = coconutBal ? Math.round(coconutBal.total * 100) / 100 : 0;
          const swTotal = Math.round((swCurMap.get(cur) ?? 0) * 100) / 100;
          const diff = Math.round((coconutTotal - swTotal) * 100) / 100;

          if (Math.abs(diff) > 0.01) {
            drifts.push({
              groupName: coconutGroup.name,
              coconutGroupId: coconutGroup.id,
              swGroupId,
              currency: cur,
              memberName: member.display_name ?? email,
              coconutBalance: coconutTotal,
              splitwiseBalance: swTotal,
              diff,
            });
          }
        }
      }
    } catch (e) {
      console.error(`[verify] Failed to verify group "${coconutGroup.name}":`, e);
      drifts.push({
        groupName: coconutGroup.name,
        coconutGroupId: coconutGroup.id,
        swGroupId,
        currency: "ERROR",
        memberName: "N/A",
        coconutBalance: 0,
        splitwiseBalance: 0,
        diff: 0,
      });
    }
  }

  return NextResponse.json({
    ok: drifts.length === 0,
    groupsChecked: linkedGroups.length,
    drifts,
  });
}
