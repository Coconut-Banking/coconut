export const dynamic = "force-dynamic";
/** Splitwise import paginates many groups/expenses; avoid client + Vercel cutting the run short. */
export const maxDuration = 300;
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import {
  getGroups,
  getExpenses,
  getCurrentUser,
  type GetExpensesOptions,
  type SplitwiseGroup,
  type SplitwiseExpense,
} from "@/lib/splitwise";

interface ImportStats {
  groups: number;
  members: number;
  expenses: number;
  settlements: number;
  skipped: number;
}

interface ImportRequestBody {
  dryRun?: boolean;
  groupIds?: number[];
  datedAfter?: string;
  updatedAfter?: string;
  limitPerPage?: number;
  maxPages?: number;
}

function parseImportOptions(body: ImportRequestBody | null) {
  const dryRun = Boolean(body?.dryRun);
  const groupIds =
    Array.isArray(body?.groupIds) && body?.groupIds.length > 0
      ? body.groupIds.filter((id) => Number.isFinite(id)).map((id) => Number(id))
      : null;

  const datedAfter = typeof body?.datedAfter === "string" ? body.datedAfter : undefined;
  const updatedAfter = typeof body?.updatedAfter === "string" ? body.updatedAfter : undefined;
  const limitPerPage = Number.isFinite(body?.limitPerPage) ? Number(body?.limitPerPage) : undefined;
  const maxPages = Number.isFinite(body?.maxPages) ? Number(body?.maxPages) : undefined;

  const expenseOptions: GetExpensesOptions = {
    limitPerPage,
    maxPages,
    ...(datedAfter ? { datedAfter } : {}),
    ...(updatedAfter ? { updatedAfter } : {}),
  };

  return { dryRun, groupIds, expenseOptions };
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: ImportRequestBody | null = null;
  try {
    body = await req.json();
  } catch {
    // Body is optional for this endpoint.
  }
  const { dryRun, groupIds, expenseOptions } = parseImportOptions(body);

  const db = getSupabase();

  // 1. Get stored Splitwise token
  const { data: tokenRow } = await db
    .from("splitwise_tokens")
    .select("access_token")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return NextResponse.json(
      { error: "Connect Splitwise first (Settings → Import from Splitwise)" },
      { status: 400 }
    );
  }

  const token = decryptToken(tokenRow.access_token);
  const stats: ImportStats = { groups: 0, members: 0, expenses: 0, settlements: 0, skipped: 0 };

  try {
    // 2. Get current Splitwise user (to know who "me" is)
    const swUser = await getCurrentUser(token);
    const clerkUser = await currentUser();
    const myEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;

    // 3. Fetch all Splitwise groups
    const swGroups = await getGroups(token);
    const filteredGroups = groupIds
      ? swGroups.filter((g) => groupIds.includes(g.id))
      : swGroups;
    console.log(`[splitwise-import] found ${swGroups.length} groups for user ${swUser.id}`);

    for (const swGroup of filteredGroups) {
      try {
        await importGroup(db, userId, token, swGroup, swUser.id, myEmail, stats, {
          dryRun,
          expenseOptions,
        });
      } catch (err) {
        console.error(`[splitwise-import] failed to import group "${swGroup.name}":`, err);
      }
    }

    console.log("[splitwise-import] done", stats);
    return NextResponse.json({
      ok: true,
      dryRun,
      importedGroupCount: filteredGroups.length,
      stats,
    });
  } catch (err) {
    console.error("[splitwise-import] fatal error:", err);
    const raw = err instanceof Error ? err.message : String(err);
    const safe = raw.trim().length > 0 ? raw.trim().slice(0, 280) : "";
    return NextResponse.json(
      {
        error:
          safe.length > 0 ? safe : "Import failed. Please try again.",
      },
      { status: 500 }
    );
  }
}

// ── Import one group ────────────────────────────────────────────────────────

type DB = ReturnType<typeof getSupabase>;

function splitwiseMemberDisplayName(m: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const bad = (x: string) => x === "" || x.toLowerCase() === "null";
  const fn = (m.first_name ?? "").trim();
  const ln = (m.last_name ?? "").trim();
  const parts = [fn, ln].filter((x) => !bad(x));
  const joined = parts.join(" ").trim();
  const em = (m.email ?? "").trim();
  return joined || (!bad(em) ? em : "Someone");
}

async function importGroup(
  db: DB,
  userId: string,
  token: string,
  swGroup: SplitwiseGroup,
  swUserId: number,
  myEmail: string | null,
  stats: ImportStats,
  opts: { dryRun: boolean; expenseOptions: GetExpensesOptions }
) {
  // Map Splitwise group_type → Coconut group_type
  const typeMap: Record<string, string> = {
    apartment: "home",
    house: "home",
    trip: "trip",
    couple: "couple",
  };
  const groupType = typeMap[swGroup.group_type] ?? "other";

  // Dry run: estimate counts only and skip writes.
  if (opts.dryRun) {
    const expenses = await getExpenses(token, swGroup.id, opts.expenseOptions);
    stats.groups++;
    stats.members += swGroup.members.length;
    for (const expense of expenses) {
      if (expense.payment) {
        stats.settlements += expense.repayments.filter((r) => safeParseFloat(r.amount) && safeParseFloat(r.amount)! > 0).length;
      } else {
        stats.expenses++;
      }
    }
    return;
  }

  // Check if already imported
  const { data: existing } = await db
    .from("groups")
    .select("id")
    .eq("source", "splitwise")
    .eq("external_id", String(swGroup.id))
    .maybeSingle();

  let groupId: string;

  if (existing) {
    groupId = existing.id;
  } else {
    const inviteToken = `inv_${randomUUID().replace(/-/g, "")}`;
    const { data: newGroup, error } = await db
      .from("groups")
      .insert({
        owner_id: userId,
        name: swGroup.name,
        group_type: groupType,
        invite_token: inviteToken,
        source: "splitwise",
        external_id: String(swGroup.id),
      })
      .select("id")
      .single();

    if (error || !newGroup) {
      console.error(`[splitwise-import] group insert error:`, error?.message);
      return;
    }
    groupId = newGroup.id;
    stats.groups++;
  }

  // 4. Import members
  const swMemberIdToCoconutId = new Map<number, string>();

  for (const swMember of swGroup.members) {
    const isMe = swMember.id === swUserId;
    const email = isMe ? (myEmail ?? swMember.email) : swMember.email;
    const displayName = splitwiseMemberDisplayName(swMember);

    // Check if member already exists in this group (by email)
    const { data: existingMember } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("email", email)
      .maybeSingle();

    if (existingMember) {
      swMemberIdToCoconutId.set(swMember.id, existingMember.id);
      continue;
    }

    const { data: newMember, error } = await db
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: isMe ? userId : null,
        email,
        display_name: displayName,
      })
      .select("id")
      .single();

    if (error || !newMember) {
      console.error(`[splitwise-import] member insert error:`, error?.message);
      continue;
    }

    swMemberIdToCoconutId.set(swMember.id, newMember.id);
    stats.members++;
  }

  // 5. Fetch and import expenses
  const expenses = await getExpenses(token, swGroup.id, opts.expenseOptions);

  const regularExpenses = expenses.filter((e) => !e.payment);
  const settlements = expenses.filter((e) => e.payment);

  // Batch-check which expenses already exist
  const allExtIds = regularExpenses.map((e) => String(e.id));
  const existingExpenseIds = new Set<string>();
  if (allExtIds.length > 0) {
    for (let i = 0; i < allExtIds.length; i += 500) {
      const batch = allExtIds.slice(i, i + 500);
      const { data } = await db
        .from("split_transactions")
        .select("external_id")
        .eq("source", "splitwise")
        .in("external_id", batch);
      for (const row of data ?? []) existingExpenseIds.add(row.external_id);
    }
  }

  // Batch-check which settlements already exist
  const allSettlementRefs = settlements.map((e) => `splitwise:${e.id}`);
  const existingSettlementRefs = new Set<string>();
  if (allSettlementRefs.length > 0) {
    for (let i = 0; i < allSettlementRefs.length; i += 500) {
      const batch = allSettlementRefs.slice(i, i + 500);
      const { data } = await db
        .from("settlements")
        .select("external_reference")
        .in("external_reference", batch);
      for (const row of data ?? []) existingSettlementRefs.add(row.external_reference);
    }
  }

  // Import expenses in batches
  const newExpenses = regularExpenses.filter((e) => !existingExpenseIds.has(String(e.id)));
  stats.skipped += regularExpenses.length - newExpenses.length;

  const BATCH = 50;
  for (let i = 0; i < newExpenses.length; i += BATCH) {
    const batch = newExpenses.slice(i, i + BATCH);
    const txRows = batch.map((expense) => {
      const payer = expense.users.reduce((best, u) =>
        (safeParseFloat(u.paid_share) ?? 0) > (safeParseFloat(best.paid_share) ?? 0) ? u : best
      );
      return {
        group_id: groupId,
        transaction_id: null,
        created_by: userId,
        payer_member_id: swMemberIdToCoconutId.get(payer.user_id) ?? null,
        source: "splitwise" as const,
        external_id: String(expense.id),
        description: expense.description,
        amount: safeParseFloat(expense.cost),
        date: expense.date.split("T")[0],
        iso_currency_code: expense.currency_code?.trim() || "USD",
      };
    });

    const { data: inserted, error: txErr } = await db
      .from("split_transactions")
      .insert(txRows)
      .select("id, external_id");

    if (txErr || !inserted) {
      console.error(`[splitwise-import] batch split_tx insert error:`, txErr?.message);
      stats.skipped += batch.length;
      continue;
    }

    const insertedByExtId = new Map(inserted.map((r) => [r.external_id, r.id]));

    const allShares: { split_transaction_id: string; member_id: string; amount: number }[] = [];
    for (const expense of batch) {
      const txId = insertedByExtId.get(String(expense.id));
      if (!txId) continue;
      for (const u of expense.users) {
        const amt = safeParseFloat(u.owed_share);
        if (amt === null || amt <= 0) continue;
        const memberId = swMemberIdToCoconutId.get(u.user_id);
        if (!memberId) continue;
        allShares.push({ split_transaction_id: txId, member_id: memberId, amount: amt });
      }
      stats.expenses++;
    }

    if (allShares.length > 0) {
      for (let j = 0; j < allShares.length; j += 500) {
        await db.from("split_shares").insert(allShares.slice(j, j + 500));
      }
    }
  }

  // Import settlements in batches
  const settlementRows: {
    group_id: string;
    payer_member_id: string;
    receiver_member_id: string;
    amount: number;
    method: string;
    status: string;
    external_reference: string;
    created_at: string;
    iso_currency_code: string;
  }[] = [];

  for (const expense of settlements) {
    const extRef = `splitwise:${expense.id}`;
    if (existingSettlementRefs.has(extRef)) {
      stats.skipped++;
      continue;
    }
    for (const repayment of expense.repayments) {
      const payerId = swMemberIdToCoconutId.get(repayment.from);
      const receiverId = swMemberIdToCoconutId.get(repayment.to);
      if (!payerId || !receiverId) continue;
      const amount = safeParseFloat(repayment.amount);
      if (amount === null || amount <= 0) continue;
      settlementRows.push({
        group_id: groupId,
        payer_member_id: payerId,
        receiver_member_id: receiverId,
        amount,
        method: "splitwise",
        status: "completed",
        external_reference: extRef,
        created_at: expense.date,
        iso_currency_code: expense.currency_code?.trim() || "USD",
      });
      stats.settlements++;
    }
  }

  if (settlementRows.length > 0) {
    for (let i = 0; i < settlementRows.length; i += 500) {
      await db.from("settlements").insert(settlementRows.slice(i, i + 500));
    }
  }
}

/** Parse a numeric string, returning null if the result is not finite. */
function safeParseFloat(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Individual importExpense/importSettlement removed — batched inline in importGroup above.
