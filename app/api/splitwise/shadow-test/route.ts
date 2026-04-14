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

const MIRROR_PREFIX = "Mirror ";

/**
 * POST /api/splitwise/shadow-test
 *
 * End-to-end test: for a given Coconut group, ensures the mirror exists with
 * members, adds a $0.01 test expense, and returns every step's result.
 * Errors are NOT swallowed — they're returned in the response.
 *
 * Body: { groupId: string }
 * Optional: { skipTestExpense: true } to only ensure mirror + members
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
    // Look by name
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

  // Step 6: Add members to mirror
  const isSwImported = (group as Record<string, unknown>).source === "splitwise" && group.external_id;

  if (isSwImported) {
    try {
      const realGroup = await getGroup(token, Number(group.external_id));
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
          steps.push({ step: `add_member_${rm.id}`, status: "skip", detail: `Skipping self (${rm.first_name})` });
          continue;
        }
        try {
          const addBody: Record<string, unknown> = {
            group_id: mirrorSwGroupId,
            user_id: rm.id,
            first_name: rm.first_name || "User",
            last_name: rm.last_name || "",
            email: rm.email || undefined,
          };
          const addRes = await fetch("https://secure.splitwise.com/api/v3.0/add_user_to_group", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(addBody),
          });
          const addResBody = await addRes.json();
          steps.push({
            step: `add_member_${rm.id}`,
            status: addRes.ok && addResBody.success !== false ? "ok" : "error",
            detail: {
              httpStatus: addRes.status,
              requestBody: addBody,
              responseBody: addResBody,
              name: `${rm.first_name} ${rm.last_name}`,
            },
          });
        } catch (e) {
          steps.push({ step: `add_member_${rm.id}`, status: "error", detail: `Failed to add ${rm.first_name} (${rm.id}): ${e}` });
        }
      }
    } catch (e) {
      steps.push({ step: "load_real_sw_group", status: "error", detail: String(e) });
    }
  } else {
    for (const member of members ?? []) {
      if (member.user_id === userId) {
        steps.push({ step: `add_member_${member.id}`, status: "skip", detail: `Skipping self (${member.display_name})` });
        continue;
      }
      const email = member.email?.trim();
      if (!email) {
        steps.push({ step: `add_member_${member.id}`, status: "error", detail: `${member.display_name} has no email — cannot add to Splitwise` });
        continue;
      }
      const nameParts = (member.display_name ?? "").split(" ");
      try {
        await addUserToSwGroup(token, mirrorSwGroupId, {
          email,
          first_name: nameParts[0] || email.split("@")[0],
          last_name: nameParts.slice(1).join(" ") || undefined,
        });
        steps.push({ step: `add_member_${member.id}`, status: "ok", detail: `Added ${member.display_name} (${email})` });
      } catch (e) {
        steps.push({ step: `add_member_${member.id}`, status: "error", detail: `Failed to add ${member.display_name} (${email}): ${e}` });
      }
    }
  }

  // Step 7: Re-fetch mirror to see final member state
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
    return NextResponse.json({ error: "Failed to refetch mirror after adding members", steps });
  }

  // Step 8: Build member mapping
  const coconutToSw = new Map<string, number>();
  for (const cm of members ?? []) {
    if (cm.user_id === userId) {
      coconutToSw.set(cm.id, swUser.id);
      continue;
    }
    const email = cm.email?.trim().toLowerCase();
    if (email) {
      const sw = mirrorGroup.members.find((m) => m.email?.trim().toLowerCase() === email);
      if (sw) { coconutToSw.set(cm.id, sw.id); continue; }
    }
    const name = cm.display_name?.trim().toLowerCase();
    if (name && name !== "you") {
      const sw = mirrorGroup.members.find((m) => {
        const full = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim().toLowerCase();
        return full === name || m.first_name?.trim().toLowerCase() === name;
      });
      if (sw) coconutToSw.set(cm.id, sw.id);
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
  if (isSwImported) {
    try {
      const realSwGroupId = Number(group.external_id);
      const realGroup = await getGroup(token, realSwGroupId);
      const realExpenses = await getExpenses(token, realSwGroupId);

      const realToMirror = new Map<number, number>();
      for (const rm of realGroup.members) {
        const email = rm.email?.trim().toLowerCase();
        if (!email) continue;
        const mm = mirrorGroup.members.find((m) => m.email?.trim().toLowerCase() === email);
        if (mm) realToMirror.set(rm.id, mm.id);
      }

      steps.push({
        step: "bootstrap_mapping",
        status: realToMirror.size > 0 ? "ok" : "error",
        detail: {
          realGroupExpenses: realExpenses.length,
          realToMirrorMappings: realToMirror.size,
          mappings: Object.fromEntries(
            Array.from(realToMirror.entries()).map(([rId, mId]) => {
              const rm = realGroup.members.find((m) => m.id === rId);
              const mm = mirrorGroup.members.find((m) => m.id === mId);
              return [rId, { realName: `${rm?.first_name} ${rm?.last_name}`, mirrorSwId: mId, mirrorName: `${mm?.first_name} ${mm?.last_name}` }];
            })
          ),
        },
      });

      // Check existing mirror expenses to avoid duplicating
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

  // Step 11: Create a test expense (unless skipped)
  if (body.skipTestExpense) {
    steps.push({ step: "test_expense", status: "skip", detail: "Skipped by request" });
  } else if (coconutToSw.size < 2) {
    steps.push({ step: "test_expense", status: "error", detail: `Need at least 2 mapped members, have ${coconutToSw.size}` });
  } else {
    const memberIds = Array.from(coconutToSw.keys());
    const payerCId = memberIds[0];
    const payerSwId = coconutToSw.get(payerCId)!;

    const users: SwExpenseUserShare[] = memberIds.map((cId) => {
      const swId = coconutToSw.get(cId)!;
      return {
        user_id: swId,
        paid_share: swId === payerSwId ? "0.01" : "0.00",
        owed_share: (0.01 / memberIds.length).toFixed(2),
      };
    });

    try {
      const { id: expId } = await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: "[TEST] Shadow write test expense",
        cost: "0.01",
        currency_code: "USD",
        users,
      });
      steps.push({
        step: "test_expense",
        status: "ok",
        detail: { swExpenseId: expId, message: "Test expense created in mirror group" },
      });
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
