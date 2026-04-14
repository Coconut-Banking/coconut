export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getExpenses,
  getCurrentUser,
} from "@/lib/splitwise";
import {
  shadowCreateExpense,
  shadowUpdateExpense,
  shadowDeleteExpense,
  shadowRecordSettlement,
  isShadowWriteEnabled,
} from "@/lib/splitwise-shadow";

type Step = { step: string; status: "ok" | "error" | "skip" | "warn"; detail: unknown };

/**
 * POST /api/splitwise/shadow-crud-test
 *
 * Full CRUD integration test: creates a real expense in Coconut, verifies
 * it appears in the Splitwise mirror, updates it, verifies the update,
 * deletes it, verifies deletion, then tests settlement sync.
 *
 * Uses a real Coconut group — creates and cleans up test data.
 *
 * Body: { groupId: string }
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = new URL(req.url);
  const adminUserId = url.searchParams.get("user_id");

  let userId: string | null;
  if (authHeader && serviceKey && authHeader === serviceKey && adminUserId) {
    userId = adminUserId;
  } else {
    userId = await getUserId();
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isShadowWriteEnabled()) {
    return NextResponse.json({ error: "SPLITWISE_SHADOW_WRITE not enabled" }, { status: 400 });
  }

  const body = await req.json();
  const groupId = body.groupId as string;
  if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

  const db = getSupabase();
  const steps: Step[] = [];
  const cleanup: (() => Promise<void>)[] = [];

  try {
    // ── Setup: resolve token, group, members ──
    const { data: tokenRow } = await db
      .from("splitwise_tokens")
      .select("access_token, shadow_mirror_map")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (!tokenRow?.access_token) {
      return NextResponse.json({ error: "No Splitwise token" }, { status: 400 });
    }
    const swToken = decryptToken(tokenRow.access_token);
    const swUser = await getCurrentUser(swToken);

    const { data: members } = await db
      .from("group_members")
      .select("id, email, display_name, user_id")
      .eq("group_id", groupId);

    if (!members || members.length < 2) {
      return NextResponse.json({ error: "Group needs at least 2 members" }, { status: 400 });
    }

    const myMember = members.find((m) => m.user_id === userId);
    const otherMember = members.find((m) => m.user_id !== userId);
    if (!myMember || !otherMember) {
      return NextResponse.json({ error: "Could not find self and another member" }, { status: 400 });
    }

    const mirrorMap = (tokenRow as Record<string, unknown>).shadow_mirror_map as Record<string, number> ?? {};
    const mirrorSwGroupId = mirrorMap[groupId];
    if (!mirrorSwGroupId) {
      return NextResponse.json({ error: "No mirror group for this group. Run shadow-test first." }, { status: 400 });
    }

    steps.push({
      step: "setup",
      status: "ok",
      detail: {
        swUser: { id: swUser.id, email: swUser.email },
        myMember: { id: myMember.id, name: myMember.display_name },
        otherMember: { id: otherMember.id, name: otherMember.display_name },
        mirrorSwGroupId,
      },
    });

    // Get initial mirror expense count for comparison
    const initialExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const initialCount = initialExpenses.length;

    // ═══════════════════════════════════════════════════════════════════
    // TEST 1: CREATE EXPENSE
    // ═══════════════════════════════════════════════════════════════════

    const testAmount = 10.00;
    const testDesc = `[CRUD-TEST] ${Date.now()}`;
    const testDate = new Date().toISOString().split("T")[0];

    // Create via RPC (same as manual-expense route)
    const { data: rpcResult, error: rpcErr } = await db.rpc("create_manual_expense", {
      p_clerk_user_id: userId,
      p_group_id: groupId,
      p_amount: testAmount,
      p_description: testDesc,
      p_currency: "USD",
      p_date: testDate,
      p_payer_member_id: myMember.id,
      p_shares: [
        { memberId: myMember.id, amount: 5.00 },
        { memberId: otherMember.id, amount: 5.00 },
      ],
    });

    if (rpcErr || !rpcResult || rpcResult.error) {
      steps.push({ step: "create_expense_db", status: "error", detail: rpcErr?.message ?? rpcResult?.error ?? "RPC failed" });
      return respond(steps);
    }

    const splitTxId = rpcResult.splitTxId;
    const txId = rpcResult.txId;
    steps.push({ step: "create_expense_db", status: "ok", detail: { splitTxId, txId } });

    // Register cleanup
    cleanup.push(async () => {
      await db.from("split_shares").delete().eq("split_transaction_id", splitTxId);
      await db.from("split_transactions").delete().eq("id", splitTxId);
      if (txId) await db.from("transactions").delete().eq("id", txId);
    });

    // Run shadow create (AWAIT it instead of fire-and-forget so we can verify)
    try {
      await shadowCreateExpense({
        clerkUserId: userId,
        groupId,
        splitTransactionId: splitTxId,
        amount: testAmount,
        description: testDesc,
        currency: "USD",
        date: testDate,
        payerMemberId: myMember.id,
        shares: [
          { memberId: myMember.id, amount: 5.00 },
          { memberId: otherMember.id, amount: 5.00 },
        ],
      });
      steps.push({ step: "create_shadow_sync", status: "ok", detail: "shadowCreateExpense completed" });
    } catch (e) {
      steps.push({ step: "create_shadow_sync", status: "error", detail: String(e) });
      await runCleanup(cleanup);
      return respond(steps);
    }

    // Verify: check split_transaction got external_id
    const { data: afterCreate } = await db
      .from("split_transactions")
      .select("external_id, source")
      .eq("id", splitTxId)
      .single();

    if (!afterCreate?.external_id || afterCreate.source !== "splitwise_mirror") {
      steps.push({ step: "create_verify_db", status: "error", detail: { external_id: afterCreate?.external_id, source: afterCreate?.source } });
      await runCleanup(cleanup);
      return respond(steps);
    }
    steps.push({ step: "create_verify_db", status: "ok", detail: { external_id: afterCreate.external_id, source: afterCreate.source } });

    // Verify: expense exists in Splitwise mirror
    const mirrorExpenseId = Number(afterCreate.external_id);
    const postCreateExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const createdInMirror = postCreateExpenses.find((e) => e.id === mirrorExpenseId);

    if (!createdInMirror) {
      steps.push({ step: "create_verify_sw", status: "error", detail: `Expense ${mirrorExpenseId} not found in mirror group` });
      await runCleanup(cleanup);
      return respond(steps);
    }

    const amountMatch = createdInMirror.cost === testAmount.toFixed(2);
    const descMatch = createdInMirror.description === testDesc;
    steps.push({
      step: "create_verify_sw",
      status: amountMatch && descMatch ? "ok" : "warn",
      detail: {
        swExpenseId: createdInMirror.id,
        description: { expected: testDesc, actual: createdInMirror.description, match: descMatch },
        cost: { expected: testAmount.toFixed(2), actual: createdInMirror.cost, match: amountMatch },
        users: createdInMirror.users.map((u) => ({
          userId: u.user_id,
          paidShare: u.paid_share,
          owedShare: u.owed_share,
        })),
      },
    });

    // ═══════════════════════════════════════════════════════════════════
    // TEST 2: UPDATE EXPENSE
    // ═══════════════════════════════════════════════════════════════════

    const updatedAmount = 20.00;
    const updatedDesc = `[CRUD-TEST-UPDATED] ${Date.now()}`;

    // Update the DB via RPC
    const { error: updateErr } = await db.rpc("update_split_transaction", {
      p_split_tx_id: splitTxId,
      p_clerk_user_id: userId,
      p_description: updatedDesc,
      p_amount: updatedAmount,
      p_payer_member_id: myMember.id,
      p_shares: [
        { memberId: myMember.id, amount: 10.00 },
        { memberId: otherMember.id, amount: 10.00 },
      ],
    });

    if (updateErr) {
      steps.push({ step: "update_expense_db", status: "error", detail: updateErr.message });
    } else {
      steps.push({ step: "update_expense_db", status: "ok", detail: { updatedDesc, updatedAmount } });
    }

    // Run shadow update
    try {
      await shadowUpdateExpense({
        clerkUserId: userId,
        splitTransactionId: splitTxId,
        groupId,
        description: updatedDesc,
        amount: updatedAmount,
        payerMemberId: myMember.id,
        shares: [
          { memberId: myMember.id, amount: 10.00 },
          { memberId: otherMember.id, amount: 10.00 },
        ],
      });
      steps.push({ step: "update_shadow_sync", status: "ok", detail: "shadowUpdateExpense completed" });
    } catch (e) {
      steps.push({ step: "update_shadow_sync", status: "error", detail: String(e) });
    }

    // Verify update in Splitwise
    await sleep(500); // Small delay for SW API consistency
    const postUpdateExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const updatedInMirror = postUpdateExpenses.find((e) => e.id === mirrorExpenseId);

    if (!updatedInMirror) {
      steps.push({ step: "update_verify_sw", status: "error", detail: "Expense disappeared from mirror after update" });
    } else {
      const updAmountMatch = updatedInMirror.cost === updatedAmount.toFixed(2);
      const updDescMatch = updatedInMirror.description === updatedDesc;
      steps.push({
        step: "update_verify_sw",
        status: updAmountMatch && updDescMatch ? "ok" : "warn",
        detail: {
          description: { expected: updatedDesc, actual: updatedInMirror.description, match: updDescMatch },
          cost: { expected: updatedAmount.toFixed(2), actual: updatedInMirror.cost, match: updAmountMatch },
          users: updatedInMirror.users.map((u) => ({
            userId: u.user_id,
            paidShare: u.paid_share,
            owedShare: u.owed_share,
          })),
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 3: DELETE EXPENSE
    // ═══════════════════════════════════════════════════════════════════

    try {
      await shadowDeleteExpense(userId, splitTxId);
      steps.push({ step: "delete_shadow_sync", status: "ok", detail: "shadowDeleteExpense completed" });
    } catch (e) {
      steps.push({ step: "delete_shadow_sync", status: "error", detail: String(e) });
    }

    // Delete from Coconut DB
    await db.from("split_shares").delete().eq("split_transaction_id", splitTxId);
    await db.from("split_transactions").delete().eq("id", splitTxId);
    if (txId) await db.from("transactions").delete().eq("id", txId);
    // Remove from cleanup since we already deleted
    cleanup.length = 0;

    steps.push({ step: "delete_expense_db", status: "ok", detail: "DB rows deleted" });

    // Verify deletion in Splitwise
    await sleep(500);
    const postDeleteExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const deletedInMirror = postDeleteExpenses.find((e) => e.id === mirrorExpenseId);

    if (deletedInMirror) {
      steps.push({ step: "delete_verify_sw", status: "error", detail: `Expense ${mirrorExpenseId} still exists in mirror after delete` });
    } else {
      steps.push({ step: "delete_verify_sw", status: "ok", detail: `Expense ${mirrorExpenseId} confirmed deleted from mirror` });
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEST 4: SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════

    const settlementAmount = 5.00;
    let settlementId: string | null = null;

    // Create settlement in DB via RPC
    const { data: settlementResult, error: settleErr } = await db.rpc("insert_settlement_checked", {
      p_group_id: groupId,
      p_clerk_user_id: userId,
      p_payer_member_id: myMember.id,
      p_receiver_member_id: otherMember.id,
      p_amount: settlementAmount,
      p_method: "manual",
      p_currency: "USD",
    });

    if (settleErr || !settlementResult || settlementResult.error) {
      steps.push({ step: "settlement_db", status: "error", detail: settleErr?.message ?? settlementResult?.error ?? "RPC failed" });
    } else {
      settlementId = settlementResult.id;
      steps.push({ step: "settlement_db", status: "ok", detail: { settlementId } });

      cleanup.push(async () => {
        if (settlementId) await db.from("settlements").delete().eq("id", settlementId);
      });
    }

    // Run shadow settlement
    try {
      await shadowRecordSettlement({
        clerkUserId: userId,
        groupId,
        payerMemberId: myMember.id,
        receiverMemberId: otherMember.id,
        amount: settlementAmount,
        currency: "USD",
      });
      steps.push({ step: "settlement_shadow_sync", status: "ok", detail: "shadowRecordSettlement completed" });
    } catch (e) {
      steps.push({ step: "settlement_shadow_sync", status: "error", detail: String(e) });
    }

    // Verify settlement in mirror
    await sleep(500);
    const postSettleExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const settlementInMirror = postSettleExpenses.find(
      (e) => e.payment && !initialExpenses.find((ie) => ie.id === e.id)
        && !postDeleteExpenses.find((de) => de.id === e.id) // Exclude pre-existing
    );

    if (!settlementInMirror) {
      steps.push({ step: "settlement_verify_sw", status: "error", detail: "Settlement payment not found in mirror" });
    } else {
      steps.push({
        step: "settlement_verify_sw",
        status: settlementInMirror.cost === settlementAmount.toFixed(2) ? "ok" : "warn",
        detail: {
          swExpenseId: settlementInMirror.id,
          isPayment: settlementInMirror.payment,
          cost: { expected: settlementAmount.toFixed(2), actual: settlementInMirror.cost },
          users: settlementInMirror.users.map((u) => ({
            userId: u.user_id,
            paidShare: u.paid_share,
            owedShare: u.owed_share,
          })),
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // CLEANUP: remove test settlement from both Coconut and mirror
    // ═══════════════════════════════════════════════════════════════════

    if (settlementInMirror) {
      try {
        const { deleteSwExpense } = await import("@/lib/splitwise");
        await deleteSwExpense(swToken, settlementInMirror.id);
        steps.push({ step: "cleanup_settlement_sw", status: "ok", detail: `Deleted mirror settlement ${settlementInMirror.id}` });
      } catch (e) {
        steps.push({ step: "cleanup_settlement_sw", status: "warn", detail: String(e) });
      }
    }

    if (settlementId) {
      await db.from("settlements").delete().eq("id", settlementId);
      cleanup.length = 0; // Already cleaned up
      steps.push({ step: "cleanup_settlement_db", status: "ok", detail: "Settlement deleted from DB" });
    }

    // Final count check
    const finalExpenses = await getExpenses(swToken, mirrorSwGroupId);
    const countDelta = finalExpenses.length - initialCount;
    steps.push({
      step: "final_count_check",
      status: countDelta === 0 ? "ok" : "warn",
      detail: {
        initialCount,
        finalCount: finalExpenses.length,
        delta: countDelta,
        message: countDelta === 0 ? "Mirror expense count unchanged (test data cleaned up)" : `Mirror has ${countDelta} more expenses than before test`,
      },
    });

  } catch (e) {
    steps.push({ step: "unhandled_error", status: "error", detail: e instanceof Error ? e.message : String(e) });
  } finally {
    await runCleanup(cleanup);
  }

  return respond(steps);
}

function respond(steps: Step[]) {
  const errors = steps.filter((s) => s.status === "error").length;
  const warnings = steps.filter((s) => s.status === "warn").length;
  const passed = steps.filter((s) => s.status === "ok").length;

  return NextResponse.json({
    ok: errors === 0,
    summary: `${passed} passed, ${warnings} warnings, ${errors} errors out of ${steps.length} steps`,
    passed,
    warnings,
    errors,
    totalSteps: steps.length,
    steps,
  });
}

async function runCleanup(fns: (() => Promise<void>)[]) {
  for (const fn of fns) {
    try { await fn(); } catch { /* best effort */ }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
