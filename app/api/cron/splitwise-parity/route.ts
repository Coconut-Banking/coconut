export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup, getExpenses, createSwExpense, deleteSwExpense, getCurrentUser } from "@/lib/splitwise";

/**
 * GET /api/cron/splitwise-parity
 *
 * Two checks per mirror group, run daily by the bug council runner:
 *
 * 1. PARITY — compares simplified_debts between real and mirror Splitwise groups.
 *    Catches data drift (manual SW edits, failed syncs, etc.)
 *
 * 2. HEARTBEAT — creates a $0.01 test expense in the mirror, verifies it appears,
 *    then deletes it. Confirms the shadow write pipeline is still alive end-to-end.
 *
 * Auth: x-admin-key header must equal SUPABASE_SERVICE_ROLE_KEY.
 * Returns: { ok, parity: [...], heartbeat: [...] }
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
    return NextResponse.json({ ok: true, parity: [], heartbeat: [], message: "No mirror groups configured" });
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

  const parityResults: ParityResult[] = [];
  const heartbeatResults: HeartbeatResult[] = [];

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

      // ── 2. Heartbeat — create, verify, delete a $0.01 test expense ───────
      if (!swUser) {
        heartbeatResults.push({ group: group.name, ok: false, detail: "Could not resolve SW user" });
        continue;
      }

      let createdId: number | null = null;
      try {
        const mirrorGroup = await getGroup(token, mirrorSwGroupId);
        const others = mirrorGroup.members.filter((m) => m.id !== swUser.id);
        if (others.length === 0) {
          heartbeatResults.push({ group: group.name, ok: false, detail: "Mirror has no other members" });
          continue;
        }

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
        createdId = id;

        // Verify it appears
        const expenses = await getExpenses(token, mirrorSwGroupId, { limitPerPage: 10, maxPages: 1 });
        const found = expenses.find((e) => e.id === createdId);

        heartbeatResults.push({
          group: group.name,
          ok: !!found,
          detail: found ? `expense ${createdId} created and verified` : `expense ${createdId} not found after creation`,
        });
      } catch (e) {
        heartbeatResults.push({
          group: group.name,
          ok: false,
          detail: `error: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        // Always clean up — never leave test expenses in the mirror
        if (createdId) {
          await deleteSwExpense(token, createdId).catch(() => {});
        }
      }
    }
  }

  const allParityOk = parityResults.every((r) => r.parity);
  const allHeartbeatOk = heartbeatResults.every((r) => r.ok);

  return NextResponse.json({
    ok: allParityOk && allHeartbeatOk,
    parity: parityResults,
    heartbeat: heartbeatResults,
  });
}
