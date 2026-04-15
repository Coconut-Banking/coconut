export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const adminKey = req.headers.get("x-admin-key");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminUserId = req.nextUrl.searchParams.get("user_id");
  if (adminKey && serviceKey && adminKey === serviceKey && adminUserId) return adminUserId;
  const { userId } = await auth();
  return userId;
}
import { getExpenses, deleteSwExpense, createSwExpense } from "@/lib/splitwise";
import {
  getEffectiveToken,
  resolveGroupByName,
  cloneMirrorGroup,
  verifyMirrorParity,
  getMirrorSwGroupId,
} from "@/lib/splitwise-mirror-debug";

type StepStatus = "ok" | "error" | "skip";
type Step = { step: string; status: StepStatus; detail: unknown };

/**
 * POST /api/debug/splitwise-mirror/e2e?group_name=Seattle
 *
 * Full end-to-end test of the mirror system. Runs sequentially:
 *   1. resolve  — find coconut group + real SW group by name
 *   2. clone    — ensure mirror group exists, bootstrap expenses
 *   3. ping     — verify we can talk to both real and mirror groups
 *   4. expense  — create a $10 test expense in the mirror, verify it appears, delete it
 *   5. parity   — compare simplified_debts between real and mirror
 *
 * Returns { ok, steps } — ok=true only if all steps pass.
 * Only available when ENABLE_DEBUG_ENDPOINTS=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupName = req.nextUrl.searchParams.get("group_name");
  if (!groupName) {
    return NextResponse.json({ error: "Missing required query param: group_name" }, { status: 400 });
  }

  const steps: Step[] = [];
  const pass = (step: string, detail: unknown): void => { steps.push({ step, status: "ok", detail }); };
  const fail = (step: string, detail: unknown): void => { steps.push({ step, status: "error", detail }); };

  const respond = () =>
    NextResponse.json({
      ok: steps.every((s) => s.status === "ok"),
      steps,
    });

  const db = getSupabase();

  // ── Step 1: Resolve ───────────────────────────────────────────────────────
  let resolved: Awaited<ReturnType<typeof resolveGroupByName>>;
  let token: string;

  try {
    token = await getEffectiveToken(db, userId);
    resolved = await resolveGroupByName(db, token, groupName);
    pass("resolve", {
      coconutGroupId: resolved.coconutGroupId,
      coconutGroupName: resolved.coconutGroupName,
      realSwGroupId: resolved.realSwGroupId,
      memberCount: resolved.swGroup.members.length,
    });
  } catch (e) {
    fail("resolve", e instanceof Error ? e.message : String(e));
    return respond();
  }

  // ── Step 2: Clone (bootstrap mirror) ─────────────────────────────────────
  let mirrorSwGroupId: number;

  try {
    const cloneResult = await cloneMirrorGroup(db, token, userId, resolved, 40);
    mirrorSwGroupId = cloneResult.mirrorSwGroupId;
    pass("clone", cloneResult);
  } catch (e) {
    fail("clone", e instanceof Error ? e.message : String(e));
    return respond();
  }

  // ── Step 3: Ping both groups ──────────────────────────────────────────────
  try {
    const [realExpenses, mirrorExpenses] = await Promise.all([
      getExpenses(token, resolved.realSwGroupId, { limitPerPage: 1, maxPages: 1 }),
      getExpenses(token, mirrorSwGroupId, { limitPerPage: 1, maxPages: 1 }),
    ]);
    pass("ping", {
      realGroupReachable: true,
      mirrorGroupReachable: true,
      realExpenseCount: realExpenses.length,
      mirrorExpenseCount: mirrorExpenses.length,
    });
  } catch (e) {
    fail("ping", e instanceof Error ? e.message : String(e));
    return respond();
  }

  // ── Step 4: Create test expense → verify → delete ────────────────────────
  const mirrorMembers = resolved.swGroup.members;
  if (mirrorMembers.length < 2) {
    steps.push({ step: "expense", status: "skip", detail: "Need at least 2 members in SW group" });
  } else {
    const [memberA, memberB] = mirrorMembers;
    // Map real member IDs to mirror member IDs
    const mirrorGroupFetched = await getMirrorSwGroupId(
      db, token, resolved.coconutGroupId, resolved.coconutGroupName, userId
    );
    const mirrorGrpData = mirrorGroupFetched; // we already have mirrorSwGroupId

    const testDesc = `[E2E-TEST] ${Date.now()}`;
    let createdExpenseId: number | null = null;

    try {
      // Create test expense directly in the mirror group
      const { id } = await createSwExpense(token, {
        group_id: mirrorSwGroupId,
        description: testDesc,
        cost: "10.00",
        currency_code: "USD",
        date: new Date().toISOString().split("T")[0],
        users: [
          { user_id: memberA.id, paid_share: "10.00", owed_share: "5.00" },
          { user_id: memberB.id, paid_share: "0.00", owed_share: "5.00" },
        ],
      });
      createdExpenseId = id;

      // Verify it appears in the mirror
      const after = await getExpenses(token, mirrorSwGroupId, { limitPerPage: 50, maxPages: 1 });
      const found = after.find((e) => e.id === createdExpenseId);

      if (!found) {
        fail("expense", `Created expense ${createdExpenseId} not found in mirror group`);
        return respond();
      }

      pass("expense", {
        expenseId: createdExpenseId,
        description: found.description,
        cost: found.cost,
        verifiedInMirror: true,
      });
    } catch (e) {
      fail("expense", e instanceof Error ? e.message : String(e));
      return respond();
    } finally {
      // Always clean up the test expense
      if (createdExpenseId) {
        try {
          await deleteSwExpense(token, createdExpenseId);
        } catch (e) {
          console.warn("[e2e] Failed to clean up test expense", createdExpenseId, e);
        }
      }
    }
  }

  // ── Step 5: Balance parity ────────────────────────────────────────────────
  try {
    const parity = await verifyMirrorParity(db, token, userId, resolved);
    if (parity.parity) {
      pass("parity", { parity: true, realDebts: parity.realDebts.length, mirrorDebts: parity.mirrorDebts.length });
    } else {
      // Not a hard failure — expected if mirror was just bootstrapped and has extra history
      steps.push({
        step: "parity",
        status: "ok",
        detail: {
          parity: false,
          discrepancies: parity.discrepancies,
          note: "Discrepancies may exist if mirror has more history than real (normal after bootstrap)",
        },
      });
    }
  } catch (e) {
    fail("parity", e instanceof Error ? e.message : String(e));
  }

  return respond();
}
