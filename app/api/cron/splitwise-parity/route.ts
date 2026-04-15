export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup, getExpenses, createSwExpense, deleteSwExpense, getCurrentUser } from "@/lib/splitwise";
import { shadowCreateExpense } from "@/lib/splitwise-shadow";

/**
 * GET /api/cron/splitwise-parity
 *
 * Three checks per mirror group, run daily by the bug council runner:
 *
 * 1. PARITY — compares simplified_debts between real and mirror Splitwise groups.
 *    Catches data drift (manual SW edits, failed syncs, etc.)
 *
 * 2. HEARTBEAT — creates a $0.01 test expense directly in the mirror via SW API,
 *    verifies it appears, then deletes it. Confirms the SW write pipeline is alive.
 *
 * 3. E2E — inserts a real split_transaction row in Coconut DB, triggers
 *    shadowCreateExpense (the same code path as a user splitting an expense),
 *    verifies the expense appears in the SW mirror, then deletes from both sides.
 *    This is the gold-standard test: full Coconut → shadow write → Splitwise pipeline.
 *
 * Auth: x-admin-key header must equal SUPABASE_SERVICE_ROLE_KEY.
 * Returns: { ok, parity: [...], heartbeat: [...], e2e: [...] }
 */
export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminKey || !serviceKey || adminKey !== serviceKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabase();

  const { data: tokenRows } = await db
    .from("splitwise_tokens")
    .select("clerk_user_id, access_token, shadow_mirror_map")
    .not("shadow_mirror_map", "eq", "{}");

  if (!tokenRows?.length) {
    return NextResponse.json({ ok: true, parity: [], heartbeat: [], e2e: [], message: "No mirror groups configured" });
  }

  type ParityResult = {
    group: string;
    parity: boolean;
    discrepancies: string[];
  };

  type HeartbeatResult = {
    group: string;
    ok: boolean;
    detail: string;
  };

  type E2EResult = {
    group: string;
    ok: boolean;
    detail: string;
  };

  const parityResults: ParityResult[] = [];
  const heartbeatResults: HeartbeatResult[] = [];
  const e2eResults: E2EResult[] = [];

  for (const row of tokenRows) {
    const mirrorMap = (row.shadow_mirror_map ?? {}) as Record<string, number>;
    if (!Object.keys(mirrorMap).length) continue;

    let token: string;
    try {
      token = decryptToken(row.access_token);
    } catch {
      continue;
    }

    const swUser = await getCurrentUser(token).catch(() => null);

    for (const [coconutGroupId, mirrorSwGroupId] of Object.entries(mirrorMap)) {
      const { data: group } = await db
        .from("groups")
        .select("name, external_id")
        .eq("id", coconutGroupId)
        .maybeSingle();

      if (!group?.external_id) continue;

      const realSwGroupId = Number(group.external_id);

      // ── 1. Parity check ──────────────────────────────────────────────────
      try {
        const [realGroup, mirrorGroup] = await Promise.all([
          getGroup(token, realSwGroupId),
          getGroup(token, mirrorSwGroupId),
        ]);

        const debtKey = (d: { from: number; to: number; amount: string; currency_code?: string }) =>
          `${d.from}->${d.to}:${parseFloat(d.amount).toFixed(2)}:${d.currency_code ?? "USD"}`;

        const realKeys = new Set((realGroup.simplified_debts ?? []).map(debtKey));
        const mirrorKeys = new Set((mirrorGroup.simplified_debts ?? []).map(debtKey));

        const discrepancies: string[] = [];
        for (const k of realKeys) if (!mirrorKeys.has(k)) discrepancies.push(`real only: ${k}`);
        for (const k of mirrorKeys) if (!realKeys.has(k)) discrepancies.push(`mirror only: ${k}`);

        parityResults.push({ group: group.name, parity: discrepancies.length === 0, discrepancies });
      } catch (e) {
        parityResults.push({
          group: group.name,
          parity: false,
          discrepancies: [`fetch error: ${e instanceof Error ? e.message : String(e)}`],
        });
      }

      // ── 2. Heartbeat — create, verify, delete a $0.01 test expense directly in SW mirror ───
      if (!swUser) {
        heartbeatResults.push({ group: group.name, ok: false, detail: "Could not resolve SW user" });
        e2eResults.push({ group: group.name, ok: false, detail: "Could not resolve SW user" });
        continue;
      }

      let heartbeatId: number | null = null;
      try {
        const mirrorGroup = await getGroup(token, mirrorSwGroupId);
        const others = mirrorGroup.members.filter((m) => m.id !== swUser.id);
        if (others.length === 0) {
          heartbeatResults.push({ group: group.name, ok: false, detail: "Mirror has no other members" });
        } else {
          const partner = others[0];
          const testDesc = `[HEARTBEAT] ${new Date().toISOString().slice(0, 10)}`;

          const { id } = await createSwExpense(token, {
            group_id: mirrorSwGroupId,
            description: testDesc,
            cost: "0.01",
            currency_code: "USD",
            users: [
              { user_id: swUser.id, paid_share: "0.01", owed_share: "0.01" },
              { user_id: partner.id, paid_share: "0.00", owed_share: "0.00" },
            ],
          });
          heartbeatId = id;

          // Verify it appears
          const expenses = await getExpenses(token, mirrorSwGroupId, { limitPerPage: 10, maxPages: 1 });
          const found = expenses.find((e) => e.id === heartbeatId);

          heartbeatResults.push({
            group: group.name,
            ok: !!found,
            detail: found ? `expense ${heartbeatId} created and verified` : `expense ${heartbeatId} not found after creation`,
          });
        }
      } catch (e) {
        heartbeatResults.push({
          group: group.name,
          ok: false,
          detail: `error: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        // Always clean up — never leave test expenses in the mirror
        if (heartbeatId) {
          await deleteSwExpense(token, heartbeatId).catch(() => {});
        }
      }

      // ── 3. E2E — insert Coconut split_transaction → shadowCreateExpense → verify in mirror ──
      // This tests the FULL pipeline: Coconut DB write → shadow write → Splitwise mirror.
      // It's the gold-standard check that a real user splitting an expense would work end-to-end.
      {
        const testSplitTxId = randomUUID();
        let e2eSwExpenseId: number | null = null;
        try {
          // Fetch group members to build realistic shares
          const { data: members } = await db
            .from("group_members")
            .select("id, user_id, display_name, email")
            .eq("group_id", coconutGroupId);

          const selfMember = (members ?? []).find((m) => m.user_id === row.clerk_user_id);
          const otherMembers = (members ?? []).filter((m) => m.user_id !== row.clerk_user_id);

          if (!selfMember) {
            e2eResults.push({ group: group.name, ok: false, detail: "Token owner is not a member of this group" });
            continue;
          }
          if (otherMembers.length === 0) {
            e2eResults.push({ group: group.name, ok: false, detail: "No other members to split with" });
            continue;
          }

          const partner = otherMembers[0];
          const today = new Date().toISOString().split("T")[0];
          const testDesc = `[E2E-TEST] ${today}`;

          // Step 1: Insert a real split_transaction row (source="e2e_test" marks it as ephemeral)
          const { error: insertErr } = await db.from("split_transactions").insert({
            id: testSplitTxId,
            group_id: coconutGroupId,
            created_by: row.clerk_user_id,
            payer_member_id: selfMember.id,
            amount: 1.00,
            description: testDesc,
            date: today,
            iso_currency_code: "USD",
            source: "e2e_test",
          } as Record<string, unknown>);

          if (insertErr) {
            e2eResults.push({ group: group.name, ok: false, detail: `DB insert failed: ${insertErr.message}` });
            continue;
          }

          // Step 2: Call shadowCreateExpense — same code path as a real user splitting
          await shadowCreateExpense({
            clerkUserId: row.clerk_user_id,
            groupId: coconutGroupId,
            splitTransactionId: testSplitTxId,
            amount: 1.00,
            description: testDesc,
            currency: "USD",
            date: today,
            payerMemberId: selfMember.id,
            shares: [
              { memberId: selfMember.id, amount: 0.50 },
              { memberId: partner.id, amount: 0.50 },
            ],
          });

          // Step 3: Re-read the split_transaction to get the SW expense ID written by shadowCreateExpense
          const { data: updatedTx } = await db
            .from("split_transactions")
            .select("external_id, source")
            .eq("id", testSplitTxId)
            .maybeSingle();

          const swExpenseId = updatedTx?.external_id ? Number(updatedTx.external_id) : null;

          if (!swExpenseId) {
            e2eResults.push({
              group: group.name,
              ok: false,
              detail: "shadowCreateExpense ran but external_id was not set on the split_transaction — shadow write likely failed silently",
            });
            continue;
          }
          e2eSwExpenseId = swExpenseId;

          // Step 4: Verify the expense appears in the SW mirror
          const mirrorExpenses = await getExpenses(token, mirrorSwGroupId, { limitPerPage: 20, maxPages: 1 });
          const found = mirrorExpenses.find((e) => e.id === e2eSwExpenseId);

          e2eResults.push({
            group: group.name,
            ok: !!found,
            detail: found
              ? `E2E passed: Coconut split_tx ${testSplitTxId} → SW mirror expense ${e2eSwExpenseId}`
              : `E2E failed: SW expense ${e2eSwExpenseId} not found in mirror after shadow write`,
          });
        } catch (e) {
          e2eResults.push({
            group: group.name,
            ok: false,
            detail: `E2E error: ${e instanceof Error ? e.message : String(e)}`,
          });
        } finally {
          // Always clean up both sides — never leave test data behind
          if (e2eSwExpenseId) {
            await deleteSwExpense(token, e2eSwExpenseId).catch(() => {});
          }
          try { await db.from("split_transactions").delete().eq("id", testSplitTxId); } catch { /* cleanup best-effort */ }
        }
      }
    }
  }

  const allParityOk = parityResults.every((r) => r.parity);
  const allHeartbeatOk = heartbeatResults.every((r) => r.ok);
  const allE2EOk = e2eResults.every((r) => r.ok);

  return NextResponse.json({
    ok: allParityOk && allHeartbeatOk && allE2EOk,
    parity: parityResults,
    heartbeat: heartbeatResults,
    e2e: e2eResults,
  });
}
