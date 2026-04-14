export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getGroup,
  getGroups,
  getExpenses,
  getCurrentUser,
  createSwGroup,
  addUserToSwGroup,
  createSwExpense,
  type SwExpenseUserShare,
} from "@/lib/splitwise";
import { phantomEmail, PHANTOM_DOMAIN } from "@/lib/splitwise-shadow";

const MIRROR_PREFIX = "Mirror ";

/**
 * POST /api/splitwise/shadow-test
 *
 * End-to-end test: for a given Coconut group, ensures a phantom-member mirror
 * exists, optionally bootstraps expenses, and returns every step's result.
 *
 * Body: { groupId: string, bootstrap?: boolean, skipTestExpense?: boolean }
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

  const body = await req.json();
  const groupId = body.groupId as string;
  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const db = getSupabase();
  const steps: { step: string; status: "ok" | "error" | "skip"; detail: unknown }[] = [];

  // Step 1: Get Splitwise token
  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token, shadow_mirror_map")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json({ error: "No Splitwise token", steps });
  }

  const token = decryptToken(tokenRow.access_token);
  steps.push({ step: "get_token", status: "ok", detail: "Token decrypted" });

  // Step 2: Get current SW user
  let swUser;
  try {
    swUser = await getCurrentUser(token);
    steps.push({ step: "get_sw_user", status: "ok", detail: { id: swUser.id, email: swUser.email } });
  } catch (e) {
    steps.push({ step: "get_sw_user", status: "error", detail: String(e) });
    return NextResponse.json({ error: "Failed to get SW user", steps });
  }

  // Step 3: Load Coconut group + members
  const { data: group } = await db
    .from("groups")
    .select("id, name, group_type, external_id, source")
    .eq("id", groupId)
    .single();

  if (!group) {
    steps.push({ step: "load_group", status: "error", detail: "Group not found" });
    return NextResponse.json({ error: "Group not found", steps });
  }

  const { data: members } = await db
    .from("group_members")
    .select("id, email, display_name, user_id")
    .eq("group_id", groupId);

  const isSwImported = (group as Record<string, unknown>).source === "splitwise" && group.external_id;

  steps.push({
    step: "load_group",
    status: "ok",
    detail: {
      group: { id: group.id, name: group.name, source: (group as Record<string, unknown>).source, external_id: group.external_id },
      members: (members ?? []).map((m) => ({ id: m.id, email: m.email, name: m.display_name, userId: m.user_id })),
    },
  });

  // Step 4: Check/load mirror map
  const mirrorMap: Record<string, number> = (
    tokenRow as Record<string, unknown>
  ).shadow_mirror_map as Record<string, number> ?? {};

  let mirrorSwGroupId: number | null = mirrorMap[groupId] ?? null;
  steps.push({ step: "check_mirror_map", status: "ok", detail: { existingMirrorId: mirrorSwGroupId, fullMap: mirrorMap } });

  // Step 5: Verify or create mirror group
  const mirrorName = `${MIRROR_PREFIX}${group.name}`;

  if (mirrorSwGroupId) {
    try {
      const existing = await getGroup(token, mirrorSwGroupId);
      steps.push({
        step: "verify_existing_mirror",
        status: "ok",
        detail: {
          id: existing.id,
          name: existing.name,
          memberCount: existing.members.length,
          members: existing.members.map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`, email: m.email })),
        },
      });
    } catch (e) {
      steps.push({ step: "verify_existing_mirror", status: "error", detail: `Mirror ${mirrorSwGroupId} not accessible: ${e}` });
      mirrorSwGroupId = null;
    }
  }

  if (!mirrorSwGroupId) {
    try {
      const allGroups = await getGroups(token);
      const found = allGroups.find((g) => g.name === mirrorName);
      if (found) {
        mirrorSwGroupId = found.id;
        steps.push({ step: "find_by_name", status: "ok", detail: { foundId: found.id, name: found.name } });
      } else {
        steps.push({ step: "find_by_name", status: "skip", detail: `No group named "${mirrorName}" found` });
      }
    } catch (e) {
      steps.push({ step: "find_by_name", status: "error", detail: String(e) });
    }
  }

  if (!mirrorSwGroupId) {
    try {
      const { id } = await createSwGroup(token, mirrorName, "other");
      mirrorSwGroupId = id;
      steps.push({ step: "create_mirror", status: "ok", detail: { newGroupId: id, name: mirrorName } });
    } catch (e) {
      steps.push({ step: "create_mirror", status: "error", detail: String(e) });
      return NextResponse.json({ error: "Failed to create mirror group", steps });
    }
  }

  // Step 6: Add PHANTOM members to mirror (no notifications to real people)
  let realSwMembers: { id: number; email?: string | null; first_name?: string; last_name?: string }[] | undefined;

  if (isSwImported) {
    try {
      const realGroup = await getGroup(token, Number(group.external_id));
      realSwMembers = realGroup.members;
      steps.push({
        step: "load_real_sw_group",
        status: "ok",
        detail: {
          realId: realGroup.id,
          realName: realGroup.name,
          members: realGroup.members.map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`, email: m.email })),
        },
      });

      for (const rm of realGroup.members) {
        if (rm.id === swUser.id) {
          steps.push({ step: `add_phantom_${rm.id}`, status: "skip", detail: `Skipping self (${rm.first_name})` });
          continue;
        }
        const pe = phantomEmail(rm.id);
        try {
          await addUserToSwGroup(token, mirrorSwGroupId, {
            email: pe,
            first_name: rm.first_name || "User",
            last_name: rm.last_name || String(rm.id),
          });
          steps.push({ step: `add_phantom_${rm.id}`, status: "ok", detail: `Added phantom ${pe} for ${rm.first_name} ${rm.last_name}` });
        } catch (e) {
          steps.push({ step: `add_phantom_${rm.id}`, status: "error", detail: `Failed to add phantom for ${rm.first_name} (${rm.id}): ${e}` });
        }
      }
    } catch (e) {
      steps.push({ step: "load_real_sw_group", status: "error", detail: String(e) });
    }
  } else {
    for (const member of members ?? []) {
      if (member.user_id === userId) {
        steps.push({ step: `add_phantom_${member.id}`, status: "skip", detail: `Skipping self (${member.display_name})` });
        continue;
      }
      const pe = `phantom_cm_${member.id}@${PHANTOM_DOMAIN}`;
      const nameParts = (member.display_name ?? "Unknown").split(" ");
      try {
        await addUserToSwGroup(token, mirrorSwGroupId, {
          email: pe,
          first_name: nameParts[0] || "Member",
          last_name: nameParts.slice(1).join(" ") || member.id.slice(0, 8),
        });
        steps.push({ step: `add_phantom_${member.id}`, status: "ok", detail: `Added phantom ${pe} for ${member.display_name}` });
      } catch (e) {
        steps.push({ step: `add_phantom_${member.id}`, status: "error", detail: `Failed to add phantom for ${member.display_name}: ${e}` });
      }
    }
  }

  // Step 7: Re-fetch mirror
  let mirrorGroup;
  try {
    mirrorGroup = await getGroup(token, mirrorSwGroupId);
    steps.push({
      step: "refetch_mirror",
      status: "ok",
      detail: {
        id: mirrorGroup.id,
        name: mirrorGroup.name,
        memberCount: mirrorGroup.members.length,
        members: mirrorGroup.members.map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}`, email: m.email })),
      },
    });
  } catch (e) {
    steps.push({ step: "refetch_mirror", status: "error", detail: String(e) });
    return NextResponse.json({ error: "Failed to refetch mirror", steps });
  }

  // Step 8: Build phantom member mapping
  const phantomToMirrorId = new Map<string, number>();
  for (const m of mirrorGroup.members) {
    const email = m.email?.trim().toLowerCase();
    if (email) phantomToMirrorId.set(email, m.id);
  }

  const coconutToSw = new Map<string, number>();
  for (const cm of members ?? []) {
    if (cm.user_id === userId) {
      coconutToSw.set(cm.id, swUser.id);
      continue;
    }
    if (isSwImported && realSwMembers) {
      const realSwId = findRealSwMember(cm, realSwMembers);
      if (realSwId) {
        const mirrorId = phantomToMirrorId.get(phantomEmail(realSwId));
        if (mirrorId) { coconutToSw.set(cm.id, mirrorId); continue; }
      }
    } else {
      const pe = `phantom_cm_${cm.id}@${PHANTOM_DOMAIN}`;
      const mirrorId = phantomToMirrorId.get(pe);
      if (mirrorId) { coconutToSw.set(cm.id, mirrorId); continue; }
    }
  }

  steps.push({
    step: "member_mapping",
    status: coconutToSw.size > 0 ? "ok" : "error",
    detail: {
      mappedCount: coconutToSw.size,
      totalMembers: (members ?? []).length,
      mappings: Object.fromEntries(
        Array.from(coconutToSw.entries()).map(([cId, swId]) => {
          const cm = (members ?? []).find((m) => m.id === cId);
          const sw = mirrorGroup.members.find((m) => m.id === swId);
          return [cId, { coconut: cm?.display_name, swId, swName: sw ? `${sw.first_name} ${sw.last_name}` : "?" }];
        })
      ),
    },
  });

  // Step 9: Persist mirror map
  mirrorMap[groupId] = mirrorSwGroupId;
  try {
    await db
      .from("splitwise_tokens")
      .update({ shadow_mirror_map: mirrorMap } as Record<string, unknown>)
      .eq("clerk_user_id", userId);
    steps.push({ step: "persist_map", status: "ok", detail: mirrorMap });
  } catch (e) {
    steps.push({ step: "persist_map", status: "error", detail: String(e) });
  }

  // Step 10: Bootstrap from real SW group if SW-imported
  if (isSwImported && realSwMembers) {
    try {
      const realSwGroupId = Number(group.external_id);
      const realExpenses = await getExpenses(token, realSwGroupId);

      const realToMirror = new Map<number, number>();
      for (const rm of realSwMembers) {
        const mirrorSelf = mirrorGroup.members.find((m) => m.id === rm.id);
        if (mirrorSelf) { realToMirror.set(rm.id, mirrorSelf.id); continue; }
        const mirrorId = phantomToMirrorId.get(phantomEmail(rm.id));
        if (mirrorId) realToMirror.set(rm.id, mirrorId);
      }

      steps.push({
        step: "bootstrap_mapping",
        status: realToMirror.size > 0 ? "ok" : "error",
        detail: {
          realGroupExpenses: realExpenses.length,
          realToMirrorMappings: realToMirror.size,
          mappings: Object.fromEntries(
            Array.from(realToMirror.entries()).map(([rId, mId]) => {
              const rm = realSwMembers.find((m) => m.id === rId);
              const mm = mirrorGroup.members.find((m) => m.id === mId);
              return [rId, { realName: `${rm?.first_name} ${rm?.last_name}`, mirrorSwId: mId, mirrorName: `${mm?.first_name} ${mm?.last_name}` }];
            })
          ),
        },
      });

      const existingMirrorExpenses = await getExpenses(token, mirrorSwGroupId);
      if (existingMirrorExpenses.length > 0) {
        steps.push({
          step: "bootstrap_expenses",
          status: "skip",
          detail: `Mirror already has ${existingMirrorExpenses.length} expenses — skipping bootstrap to avoid duplicates`,
        });
      } else if (body.bootstrap === true) {
        let copied = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const expense of realExpenses) {
          const users: SwExpenseUserShare[] = [];
          let allMapped = true;
          for (const u of expense.users) {
            const mirrorId = realToMirror.get(u.user_id);
            if (!mirrorId) { allMapped = false; break; }
            users.push({ user_id: mirrorId, paid_share: u.paid_share, owed_share: u.owed_share });
          }
          if (!allMapped || users.length === 0) { skipped++; continue; }

          try {
            await createSwExpense(token, {
              group_id: mirrorSwGroupId,
              description: expense.description,
              cost: expense.cost,
              currency_code: expense.currency_code,
              date: expense.date,
              payment: expense.payment || undefined,
              users,
            });
            copied++;
          } catch (e) {
            errors.push(`Expense ${expense.id} (${expense.description}): ${e}`);
            skipped++;
          }
        }

        steps.push({
          step: "bootstrap_expenses",
          status: errors.length === 0 ? "ok" : "error",
          detail: { copied, skipped, errors: errors.slice(0, 10) },
        });
      } else {
        steps.push({
          step: "bootstrap_expenses",
          status: "skip",
          detail: `Mirror has 0 expenses and ${realExpenses.length} real expenses available. Pass { "bootstrap": true } to copy them.`,
        });
      }
    } catch (e) {
      steps.push({ step: "bootstrap", status: "error", detail: String(e) });
    }
  }

  // Step 11: Test expense
  if (body.skipTestExpense) {
    steps.push({ step: "test_expense", status: "skip", detail: "Skipped by request" });
  } else if (coconutToSw.size < 2) {
    steps.push({ step: "test_expense", status: "error", detail: `Need at least 2 mapped members, have ${coconutToSw.size}` });
  } else {
    const memberIds = Array.from(coconutToSw.keys());
    const payerCId = memberIds[0];
    const payerSwId = coconutToSw.get(payerCId)!;
    const perPerson = (0.01 / memberIds.length).toFixed(2);

    const users: SwExpenseUserShare[] = memberIds.map((cId) => {
      const swId = coconutToSw.get(cId)!;
      return {
        user_id: swId,
        paid_share: swId === payerSwId ? "0.01" : "0.00",
        owed_share: perPerson,
      };
    });

    try {
      const { id: expId } = await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: "[TEST] Shadow write test",
        cost: "0.01",
        currency_code: "USD",
        users,
      });
      steps.push({ step: "test_expense", status: "ok", detail: { swExpenseId: expId } });
    } catch (e) {
      steps.push({ step: "test_expense", status: "error", detail: String(e) });
    }
  }

  const hasErrors = steps.some((s) => s.status === "error");
  return NextResponse.json({
    ok: !hasErrors,
    mirrorSwGroupId,
    stepsTotal: steps.length,
    stepsOk: steps.filter((s) => s.status === "ok").length,
    stepsError: steps.filter((s) => s.status === "error").length,
    steps,
  });
}

function findRealSwMember(
  coconutMember: { email?: string | null; display_name?: string | null },
  realSwMembers: { id: number; email?: string | null; first_name?: string; last_name?: string }[],
): number | null {
  const email = coconutMember.email?.trim().toLowerCase();
  if (email) {
    const found = realSwMembers.find((m) => m.email?.trim().toLowerCase() === email);
    if (found) return found.id;
  }
  const name = coconutMember.display_name?.trim().toLowerCase();
  if (name && name !== "you") {
    const found = realSwMembers.find((m) => {
      const full = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
      return full === name || m.first_name?.trim().toLowerCase() === name;
    });
    if (found) return found.id;
  }
  return null;
}
