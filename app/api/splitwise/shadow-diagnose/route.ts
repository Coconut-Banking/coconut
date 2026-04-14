export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getGroup, getGroups, getExpenses, getCurrentUser } from "@/lib/splitwise";
import { isShadowWriteEnabled } from "@/lib/splitwise-shadow";

/**
 * GET /api/splitwise/shadow-diagnose
 *
 * Full diagnostic for the dual-write mirror setup. Shows:
 * - Whether shadow write is enabled
 * - The mirror map (coconut group → mirror SW group)
 * - For each mirror: members, expenses, member mapping quality
 * - Surfaces the actual errors instead of swallowing them
 */
export async function GET(req: Request) {
  // Allow admin access via service role key for CLI diagnostics
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

  const db = getSupabase();
  const diag: Record<string, unknown> = {
    shadowWriteEnabled: isShadowWriteEnabled(),
    timestamp: new Date().toISOString(),
  };

  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token, shadow_mirror_map")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json({ ...diag, error: "No Splitwise token. Connect Splitwise first." });
  }

  const token = decryptToken(tokenRow.access_token);

  let swUser;
  try {
    swUser = await getCurrentUser(token);
    diag.splitwiseUser = { id: swUser.id, name: `${swUser.first_name} ${swUser.last_name}`, email: swUser.email };
  } catch (e) {
    return NextResponse.json({ ...diag, error: `Failed to get SW user: ${e}` });
  }

  const mirrorMap: Record<string, number> = (
    tokenRow as Record<string, unknown>
  ).shadow_mirror_map as Record<string, number> ?? {};

  diag.mirrorMap = mirrorMap;
  const coconutGroupIds = Object.keys(mirrorMap);

  if (coconutGroupIds.length === 0) {
    diag.message = "No mirror groups in map. Mirrors are created lazily when you add an expense to a group.";
    // Still check Splitwise for any orphaned mirror groups
    try {
      const allSwGroups = await getGroups(token);
      const mirrorGroups = allSwGroups.filter((g) => g.name.startsWith("Mirror "));
      diag.orphanedMirrorGroups = mirrorGroups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.members.length,
        members: g.members.map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`, email: m.email })),
      }));
    } catch (e) {
      diag.swGroupsError = String(e);
    }
    return NextResponse.json(diag);
  }

  // Load coconut groups
  const { data: groups } = await db
    .from("groups")
    .select("id, name, group_type, external_id, source")
    .in("id", coconutGroupIds);

  const groupDiags = [];

  for (const cGroup of groups ?? []) {
    const mirrorSwGroupId = mirrorMap[cGroup.id];
    if (!mirrorSwGroupId) continue;

    const gd: Record<string, unknown> = {
      coconutGroup: { id: cGroup.id, name: cGroup.name, source: (cGroup as Record<string, unknown>).source, external_id: cGroup.external_id },
      mirrorSwGroupId,
    };

    // Coconut members
    const { data: coconutMembers } = await db
      .from("group_members")
      .select("id, email, display_name, user_id")
      .eq("group_id", cGroup.id);

    gd.coconutMembers = (coconutMembers ?? []).map((m) => ({
      id: m.id,
      email: m.email,
      displayName: m.display_name,
      userId: m.user_id,
      hasEmail: !!m.email?.trim(),
    }));

    // Mirror group from Splitwise
    try {
      const mirrorGroup = await getGroup(token, mirrorSwGroupId);
      gd.mirrorSwGroup = {
        id: mirrorGroup.id,
        name: mirrorGroup.name,
        memberCount: mirrorGroup.members.length,
        members: mirrorGroup.members.map((m) => ({
          id: m.id,
          name: `${m.first_name} ${m.last_name}`,
          email: m.email,
        })),
        simplifiedDebts: mirrorGroup.simplified_debts,
      };

      // Try to count expenses in mirror
      try {
        const mirrorExpenses = await getExpenses(token, mirrorSwGroupId, { maxPages: 1, limitPerPage: 50 });
        gd.mirrorExpenseCount = mirrorExpenses.length;
        gd.mirrorExpenseSample = mirrorExpenses.slice(0, 3).map((e) => ({
          id: e.id,
          description: e.description,
          cost: e.cost,
          currency: e.currency_code,
          date: e.date,
          payment: e.payment,
          userCount: e.users.length,
        }));
      } catch (e) {
        gd.mirrorExpensesError = String(e);
      }

      // Member mapping quality
      const coconutToSw = new Map<string, { swId: number; matchedBy: string }>();
      const unmapped: string[] = [];

      for (const cm of coconutMembers ?? []) {
        // Check token owner match
        if (cm.user_id === userId) {
          coconutToSw.set(cm.id, { swId: swUser.id, matchedBy: "token_owner" });
          continue;
        }
        // Check email match
        const email = cm.email?.trim().toLowerCase();
        if (email) {
          const swMatch = mirrorGroup.members.find((m) => m.email?.trim().toLowerCase() === email);
          if (swMatch) {
            coconutToSw.set(cm.id, { swId: swMatch.id, matchedBy: "email" });
            continue;
          }
        }
        // Check name match
        const name = cm.display_name?.trim().toLowerCase();
        if (name && name !== "you") {
          const swMatch = mirrorGroup.members.find((m) => {
            const full = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
            return full === name || m.first_name?.trim().toLowerCase() === name;
          });
          if (swMatch) {
            coconutToSw.set(cm.id, { swId: swMatch.id, matchedBy: "name" });
            continue;
          }
        }
        unmapped.push(`${cm.display_name ?? "?"} (${cm.email ?? "no email"}, id=${cm.id})`);
      }

      gd.memberMapping = {
        mapped: Object.fromEntries(Array.from(coconutToSw.entries()).map(([k, v]) => [k, v])),
        unmapped,
        total: (coconutMembers ?? []).length,
        mappedCount: coconutToSw.size,
        unmappedCount: unmapped.length,
      };

      // If SW-imported, also show real group state
      if (cGroup.external_id && (cGroup as Record<string, unknown>).source === "splitwise") {
        try {
          const realGroup = await getGroup(token, Number(cGroup.external_id));
          const realExpenses = await getExpenses(token, Number(cGroup.external_id), { maxPages: 1, limitPerPage: 10 });
          gd.realSwGroup = {
            id: realGroup.id,
            name: realGroup.name,
            memberCount: realGroup.members.length,
            members: realGroup.members.map((m) => ({
              id: m.id,
              name: `${m.first_name} ${m.last_name}`,
              email: m.email,
            })),
            expenseCount: realExpenses.length,
          };
        } catch (e) {
          gd.realSwGroupError = String(e);
        }
      }
    } catch (e) {
      gd.mirrorGroupError = String(e);
    }

    // Coconut split_transactions for this group
    const { data: splits } = await db
      .from("split_transactions")
      .select("id, source, external_id, description, amount")
      .eq("group_id", cGroup.id)
      .limit(20);

    gd.coconutSplits = {
      total: (splits ?? []).length,
      bySource: (splits ?? []).reduce((acc, s) => {
        const src = (s as Record<string, unknown>).source as string ?? "null";
        acc[src] = (acc[src] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      mirrorWritten: (splits ?? []).filter((s) => (s as Record<string, unknown>).source === "splitwise_mirror").length,
    };

    groupDiags.push(gd);
  }

  diag.groups = groupDiags;
  return NextResponse.json(diag, { status: 200 });
}
