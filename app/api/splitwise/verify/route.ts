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

interface Drift {
  groupName: string;
  coconutGroupId: string;
  swGroupId: number;
  mirrorGroupId: number | null;
  currency: string;
  memberName: string;
  coconutBalance: number;
  splitwiseBalance: number;
  diff: number;
}

/**
 * GET /api/splitwise/verify
 *
 * Compare Coconut balances against the Splitwise MIRROR groups.
 * If shadow write is enabled, compares against mirror groups.
 * Otherwise falls back to comparing against real groups.
 *
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
  const useMirror = isShadowWriteEnabled();

  // Find all Coconut groups (both imported and native with mirrors)
  const { data: allGroups } = await db
    .from("groups")
    .select("id, name, external_id, source")
    .not("external_id", "is", null);

  if (!allGroups || allGroups.length === 0) {
    return NextResponse.json({ ok: true, drifts: [], message: "No linked groups found" });
  }

  const drifts: Drift[] = [];
  let groupsChecked = 0;

  for (const coconutGroup of allGroups) {
    const realSwGroupId = Number(coconutGroup.external_id);

    // Determine which Splitwise group to compare against
    let compareSwGroupId: number;
    let mirrorGroupId: number | null = null;

    if (useMirror) {
      const mirrorId = await getMirrorGroupId(db, token, coconutGroup.id, userId);
      if (!mirrorId) {
        // No mirror yet — skip (will be created on first write)
        continue;
      }
      mirrorGroupId = mirrorId;
      compareSwGroupId = mirrorId;
    } else {
      compareSwGroupId = realSwGroupId;
    }

    try {
      // Fetch Splitwise group (has simplified_debts) and Coconut data in parallel
      const [swGroup, membersResult, splitsResult, settlementsResult] = await Promise.all([
        getGroup(token, compareSwGroupId),
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

      // Parse Splitwise simplified_debts into per-member balances (by email)
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
              swGroupId: realSwGroupId,
              mirrorGroupId,
              currency: cur,
              memberName: member.display_name ?? email,
              coconutBalance: coconutTotal,
              splitwiseBalance: swTotal,
              diff,
            });
          }
        }
      }

      groupsChecked++;
    } catch (e) {
      console.error(`[verify] Failed to verify group "${coconutGroup.name}":`, e);
      drifts.push({
        groupName: coconutGroup.name,
        coconutGroupId: coconutGroup.id,
        swGroupId: realSwGroupId,
        mirrorGroupId,
        currency: "ERROR",
        memberName: `Error: ${e instanceof Error ? e.message : String(e)}`,
        coconutBalance: 0,
        splitwiseBalance: 0,
        diff: 0,
      });
      groupsChecked++;
    }
  }

  return NextResponse.json({
    ok: drifts.length === 0,
    mode: useMirror ? "mirror" : "direct",
    groupsChecked,
    drifts,
  });
}
