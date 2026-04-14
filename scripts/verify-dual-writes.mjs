/**
 * E2E verification script: tests balance computation against real DB data.
 * Verifies the settlement-filtering fix is correct for all SW-linked groups.
 *
 * Run: node scripts/verify-dual-writes.mjs
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeBalances(paidRows, owedRows, paidSett, recvSett) {
  const map = new Map();
  const get = (id) => {
    if (!map.has(id)) map.set(id, { paid: 0, owed: 0, adj: 0 });
    return map.get(id);
  };
  for (const r of paidRows) get(r.id).paid += r.amount;
  for (const r of owedRows) get(r.id).owed += r.amount;
  for (const r of paidSett) get(r.id).adj += r.amount;
  for (const r of recvSett) get(r.id).adj -= r.amount;

  const result = new Map();
  for (const [id, m] of map) {
    const total = round2(m.paid - m.owed + m.adj);
    if (Math.abs(total) > 0.01) result.set(id, total);
  }
  return result;
}

async function main() {
  console.log("=== Balance Computation Verification ===\n");

  // 1. Find all SW-linked groups
  const { data: swGroups, error: swErr } = await db
    .from("groups")
    .select("id, name, external_id, source, owner_id")
    .eq("source", "splitwise")
    .not("external_id", "is", null);

  if (swErr) {
    console.error("Failed to fetch SW groups:", swErr.message);
    process.exit(1);
  }

  if (!swGroups?.length) {
    console.log("No Splitwise-linked groups.\n");
  } else {
    console.log(`Found ${swGroups.length} Splitwise-linked groups.\n`);
  }

  let totalIssues = 0;

  for (const group of swGroups ?? []) {
    console.log(`┌─ ${group.name} (${group.id.slice(0, 8)}…)`);

    const [splitsRes, settRes, membersRes] = await Promise.all([
      db
        .from("split_transactions")
        .select("id, transaction_id, payer_member_id, amount, iso_currency_code, source, created_by")
        .eq("group_id", group.id),
      db
        .from("settlements")
        .select("payer_member_id, receiver_member_id, amount, method, status, iso_currency_code")
        .eq("group_id", group.id)
        .eq("status", "completed"),
      db
        .from("group_members")
        .select("id, display_name, email, user_id")
        .eq("group_id", group.id),
    ]);

    const allSplits = splitsRes.data ?? [];
    const allSettlements = settRes.data ?? [];
    const members = membersRes.data ?? [];

    const nativeSplits = allSplits.filter((s) => s.source !== "splitwise");
    const swSplits = allSplits.filter((s) => s.source === "splitwise");
    const nativeSettlements = allSettlements.filter((s) => s.method !== "splitwise");
    const swSettlements = allSettlements.filter((s) => s.method === "splitwise");

    console.log(`│  Members: ${members.length}`);
    console.log(`│  Splits: ${allSplits.length} total (${nativeSplits.length} native, ${swSplits.length} imported-sw)`);
    console.log(`│  Settlements: ${allSettlements.length} total (${nativeSettlements.length} native, ${swSettlements.length} imported-sw)`);

    // Deduplicate native splits
    const seen = new Set();
    const dedupedNative = nativeSplits.filter((s) => {
      const k = s.transaction_id ?? s.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Load shares for native splits
    const splitIds = dedupedNative.map((s) => s.id);
    const { data: shares } =
      splitIds.length > 0
        ? await db
            .from("split_shares")
            .select("split_transaction_id, member_id, amount")
            .in("split_transaction_id", splitIds)
        : { data: [] };

    // Build paid/owed from NATIVE ONLY
    const paidRows = [];
    const owedRows = [];

    for (const split of dedupedNative) {
      const payerId = split.payer_member_id;
      const amt = Math.abs(Number(split.amount) || 0);
      if (payerId && amt > 0) {
        paidRows.push({ id: payerId, amount: amt });
      }
      for (const sh of (shares ?? []).filter(
        (s) => s.split_transaction_id === split.id
      )) {
        if (Number(sh.amount) > 0) {
          owedRows.push({ id: sh.member_id, amount: Number(sh.amount) });
        }
      }
    }

    // FIXED: native settlements only
    const fixedBals = computeBalances(
      paidRows,
      owedRows,
      nativeSettlements.map((s) => ({
        id: s.payer_member_id,
        amount: Number(s.amount),
      })),
      nativeSettlements.map((s) => ({
        id: s.receiver_member_id,
        amount: Number(s.amount),
      }))
    );

    // BUGGY: ALL settlements (old code)
    const buggyBals = computeBalances(
      paidRows,
      owedRows,
      allSettlements.map((s) => ({
        id: s.payer_member_id,
        amount: Number(s.amount),
      })),
      allSettlements.map((s) => ({
        id: s.receiver_member_id,
        amount: Number(s.amount),
      }))
    );

    // Compare
    const allMemberIds = new Set([...fixedBals.keys(), ...buggyBals.keys()]);
    let hasDrift = false;

    console.log("│");
    console.log("│  Per-member native-only balance (FIXED vs OLD-BUGGY):");

    for (const mid of allMemberIds) {
      const member = members.find((m) => m.id === mid);
      const name = (member?.display_name ?? member?.email ?? mid.slice(0, 8)).padEnd(
        25
      );
      const fixed = fixedBals.get(mid) ?? 0;
      const buggy = buggyBals.get(mid) ?? 0;
      const drift = round2(fixed - buggy);

      if (Math.abs(drift) > 0.01) {
        hasDrift = true;
        totalIssues++;
        console.log(
          `│  ✗ ${name} FIXED: ${fixed >= 0 ? "+" : ""}${fixed.toFixed(2)}  BUGGY: ${buggy >= 0 ? "+" : ""}${buggy.toFixed(2)}  DRIFT: ${drift.toFixed(2)}`
        );
      } else if (Math.abs(fixed) > 0.01) {
        console.log(
          `│  ✓ ${name} ${fixed >= 0 ? "+" : ""}${fixed.toFixed(2)}  (same in both)`
        );
      }
    }

    if (allMemberIds.size === 0) {
      console.log("│  (no native expenses → nothing to compare)");
    }

    if (swSettlements.length === 0 && !hasDrift) {
      console.log("│  (no imported SW settlements → no drift possible)");
    }

    if (hasDrift) {
      console.log("│");
      console.log(
        `│  ⚠ The old code double-counted ${swSettlements.length} imported SW settlement(s)`
      );
      console.log(
        `│    totaling: $${round2(swSettlements.reduce((s, r) => s + Number(r.amount), 0)).toFixed(2)}`
      );
    }

    console.log(`└─ ${hasDrift ? "✗ FIX MATTERS HERE" : "✓ OK"}\n`);
  }

  // 2. Non-SW group zero-sum sanity check
  console.log("=== Non-SW Group Zero-Sum Check ===\n");

  const { data: allGroups } = await db
    .from("groups")
    .select("id, name, source")
    .or("source.is.null,source.neq.splitwise")
    .limit(30);

  let nativeGroupsChecked = 0;
  for (const g of allGroups ?? []) {
    const { data: splits } = await db
      .from("split_transactions")
      .select("id, payer_member_id, amount")
      .eq("group_id", g.id);

    if (!splits?.length) continue;

    const { data: setts } = await db
      .from("settlements")
      .select("payer_member_id, receiver_member_id, amount, method")
      .eq("group_id", g.id)
      .eq("status", "completed");

    const splitIds = splits.map((s) => s.id);
    const { data: shares } =
      splitIds.length > 0
        ? await db
            .from("split_shares")
            .select("split_transaction_id, member_id, amount")
            .in("split_transaction_id", splitIds)
        : { data: [] };

    const paidRows = splits
      .filter((s) => s.payer_member_id && Math.abs(Number(s.amount)) > 0)
      .map((s) => ({ id: s.payer_member_id, amount: Math.abs(Number(s.amount)) }));
    const owedRows = (shares ?? [])
      .filter((s) => Number(s.amount) > 0)
      .map((s) => ({ id: s.member_id, amount: Number(s.amount) }));

    const bals = computeBalances(
      paidRows,
      owedRows,
      (setts ?? []).map((s) => ({
        id: s.payer_member_id,
        amount: Number(s.amount),
      })),
      (setts ?? []).map((s) => ({
        id: s.receiver_member_id,
        amount: Number(s.amount),
      }))
    );

    let sum = 0;
    for (const v of bals.values()) sum += v;
    sum = round2(sum);

    if (Math.abs(sum) > 0.02) {
      console.log(
        `  ✗ ${g.name}: balance sum = ${sum.toFixed(2)} (should be ~0) — ${splits.length} splits`
      );
      totalIssues++;
    } else {
      console.log(
        `  ✓ ${g.name}: ${splits.length} splits, ${(setts ?? []).length} settlements, zero-sum ✓`
      );
    }
    nativeGroupsChecked++;
  }

  console.log(`\nChecked ${nativeGroupsChecked} non-SW groups.\n`);

  // Summary
  console.log("════════════════════════════════════");
  console.log(`SW groups checked:     ${(swGroups ?? []).length}`);
  console.log(`Non-SW groups checked: ${nativeGroupsChecked}`);
  console.log(`Issues found:          ${totalIssues}`);
  console.log(
    totalIssues === 0
      ? "\n✓ ALL BALANCE CHECKS PASS"
      : "\n✗ ISSUES FOUND — SEE ABOVE"
  );
  console.log(`\nTo verify Splitwise mirror balances match, hit:`);
  console.log(`  https://coconut-app.dev/api/splitwise/verify`);
  console.log(`  (must be logged in to production)\n`);

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
