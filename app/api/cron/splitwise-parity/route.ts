export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup } from "@/lib/splitwise";

/**
 * GET /api/cron/splitwise-parity
 *
 * Checks that every group's Splitwise mirror has matching simplified_debts
 * compared to the real Splitwise group. Called daily by the bug council runner.
 *
 * Auth: x-admin-key header must equal SUPABASE_SERVICE_ROLE_KEY.
 * Returns: { ok, results: [{ group, parity, realDebts, mirrorDebts, discrepancies }] }
 */
export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminKey || !serviceKey || adminKey !== serviceKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabase();

  // Find all users with a shadow_mirror_map
  const { data: tokenRows } = await db
    .from("splitwise_tokens")
    .select("clerk_user_id, access_token, shadow_mirror_map")
    .not("shadow_mirror_map", "eq", "{}");

  if (!tokenRows?.length) {
    return NextResponse.json({ ok: true, results: [], message: "No mirror groups configured" });
  }

  type ParityResult = {
    group: string;
    coconutGroupId: string;
    realSwGroupId: number;
    mirrorSwGroupId: number;
    parity: boolean;
    realDebts: unknown[];
    mirrorDebts: unknown[];
    discrepancies: string[];
  };

  const results: ParityResult[] = [];

  for (const row of tokenRows) {
    const mirrorMap = (row.shadow_mirror_map ?? {}) as Record<string, number>;
    if (!Object.keys(mirrorMap).length) continue;

    let token: string;
    try {
      token = decryptToken(row.access_token);
    } catch {
      continue;
    }

    for (const [coconutGroupId, mirrorSwGroupId] of Object.entries(mirrorMap)) {
      const { data: group } = await db
        .from("groups")
        .select("name, external_id")
        .eq("id", coconutGroupId)
        .maybeSingle();

      if (!group?.external_id) continue;

      const realSwGroupId = Number(group.external_id);

      try {
        const [realGroup, mirrorGroup] = await Promise.all([
          getGroup(token, realSwGroupId),
          getGroup(token, mirrorSwGroupId),
        ]);

        const realDebts = realGroup.simplified_debts ?? [];
        const mirrorDebts = mirrorGroup.simplified_debts ?? [];

        // Normalize debt to a comparable string key
        const debtKey = (d: { from: number; to: number; amount: string; currency_code?: string }) =>
          `${d.from}->${d.to}:${parseFloat(d.amount).toFixed(2)}:${d.currency_code ?? "USD"}`;

        const realKeys = new Set(realDebts.map(debtKey));
        const mirrorKeys = new Set(mirrorDebts.map(debtKey));

        const discrepancies: string[] = [];
        for (const k of realKeys) {
          if (!mirrorKeys.has(k)) discrepancies.push(`real only: ${k}`);
        }
        for (const k of mirrorKeys) {
          if (!realKeys.has(k)) discrepancies.push(`mirror only: ${k}`);
        }

        results.push({
          group: group.name,
          coconutGroupId,
          realSwGroupId,
          mirrorSwGroupId,
          parity: discrepancies.length === 0,
          realDebts,
          mirrorDebts,
          discrepancies,
        });
      } catch (e) {
        results.push({
          group: group.name,
          coconutGroupId,
          realSwGroupId,
          mirrorSwGroupId,
          parity: false,
          realDebts: [],
          mirrorDebts: [],
          discrepancies: [`Error fetching groups: ${e instanceof Error ? e.message : String(e)}`],
        });
      }
    }
  }

  const allParity = results.every((r) => r.parity);
  return NextResponse.json({ ok: allParity, results });
}
