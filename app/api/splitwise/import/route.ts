export const dynamic = "force-dynamic";
/** Splitwise import paginates many groups/expenses; avoid client + Vercel cutting the run short. */
export const maxDuration = 300;
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { getUserId } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { findClerkUserIdsByEmails } from "@/lib/clerk-user-lookup";
import {
  getGroups,
  getExpenses,
  getCurrentUser,
  getFriends,
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
  totalExpenses: number;
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
  const stats: ImportStats = { groups: 0, members: 0, expenses: 0, settlements: 0, skipped: 0, totalExpenses: 0 };

  try {
    // 2+3. Fetch current user identity and all groups in parallel (independent calls)
    const [swUser, clerkUser, swGroups] = await Promise.all([
      getCurrentUser(token),
      currentUser(),
      getGroups(token),
    ]);
    const myEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    const filteredGroups = groupIds
      ? swGroups.filter((g) => groupIds.includes(g.id))
      : swGroups;
    console.log(`[splitwise-import] found ${swGroups.length} groups for user ${swUser.id}`);

    // Batch look up all member emails to link existing Coconut users
    const allMemberEmails = new Set<string>();
    for (const g of filteredGroups) {
      for (const m of g.members) {
        const email = (m.email ?? "").trim().toLowerCase();
        if (email && email !== (myEmail ?? "").toLowerCase()) {
          allMemberEmails.add(email);
        }
      }
    }
    const emailToClerkId = dryRun
      ? new Map<string, string>()
      : await findClerkUserIdsByEmails([...allMemberEmails]);
    if (emailToClerkId.size > 0) {
      console.log(`[splitwise-import] found ${emailToClerkId.size} existing Coconut user(s) among Splitwise members`);
    }

    for (const swGroup of filteredGroups) {
      try {
        await importGroup(db, userId, token, swGroup, swUser.id, myEmail, emailToClerkId, stats, {
          dryRun,
          expenseOptions,
        });
      } catch (err) {
        console.error(`[splitwise-import] failed to import group "${swGroup.name}":`, err);
      }
    }

    await Promise.all([
      (async () => {
        try {
          const friends = await getFriends(token);
          const balancePayload = friends
            .filter((f) => f.balance && f.balance.length > 0)
            .map((f) => ({
              id: f.id,
              first_name: f.first_name,
              last_name: f.last_name,
              email: f.email ?? null,
              balance: f.balance,
            }));
          await db
            .from("splitwise_tokens")
            .update({ cached_friend_balances: balancePayload } as Record<string, unknown>)
            .eq("clerk_user_id", userId);
        } catch (err) {
          console.warn("[splitwise-import] failed to cache friend balances:", err);
        }
      })(),
      (async () => {
        try {
          const cachedGroupBalances = swGroups.map((g) => {
            const byCurrency = new Map<string, number>();
            for (const debt of g.simplified_debts ?? []) {
              const cur = (debt.currency_code ?? "USD").trim().toUpperCase() || "USD";
              const amount = parseFloat(debt.amount);
              if (!Number.isFinite(amount)) continue;
              if (debt.from === swUser.id) {
                byCurrency.set(cur, (byCurrency.get(cur) ?? 0) - amount);
              } else if (debt.to === swUser.id) {
                byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + amount);
              }
            }
            return {
              external_id: String(g.id),
              balances: [...byCurrency.entries()].map(([currency_code, amount]) => ({
                currency_code,
                amount: String(Math.round(amount * 100) / 100),
              })),
            };
          });
          await db
            .from("splitwise_tokens")
            .update({ cached_group_balances: cachedGroupBalances } as Record<string, unknown>)
            .eq("clerk_user_id", userId);
        } catch (err) {
          console.warn("[splitwise-import] failed to cache group balances:", err);
        }
      })(),
    ]);

    console.log("[splitwise-import] done", stats);
    if (!dryRun && (stats.expenses + stats.settlements) > 0) {
      revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
      revalidateTag(CACHE_TAGS.transactions(userId), "max");
    }

    // Collect uninvited members (no user_id) for the invite prompt
    let uninvitedMembers: { displayName: string; email: string | null; groupName: string; inviteToken: string | null }[] = [];
    if (!dryRun) {
      try {
        const importedGroupIds = filteredGroups.map((g) => String(g.id));
        const { data: coconutGroups } = await db
          .from("groups")
          .select("id, name, invite_token")
          .eq("owner_id", userId)
          .eq("source", "splitwise")
          .in("external_id", importedGroupIds);

        if (coconutGroups && coconutGroups.length > 0) {
          const gids = coconutGroups.map((g) => g.id);
          const gMap = new Map(coconutGroups.map((g) => [g.id, g.name]));
          const gTokenMap = new Map(coconutGroups.map((g) => [g.id, (g as { invite_token?: string }).invite_token ?? null]));
          const { data: nullMembers } = await db
            .from("group_members")
            .select("display_name, email, group_id")
            .in("group_id", gids)
            .is("user_id", null);

          const seen = new Set<string>();
          for (const m of nullMembers ?? []) {
            const key = m.email?.toLowerCase() ?? `${m.group_id}-${m.display_name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            uninvitedMembers.push({
              displayName: m.display_name,
              email: m.email ?? null,
              groupName: gMap.get(m.group_id) ?? "Unknown",
              inviteToken: gTokenMap.get(m.group_id) ?? null,
            });
          }
          uninvitedMembers.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
      } catch (e) {
        console.warn("[splitwise-import] failed to collect uninvited members:", e);
      }
    }

    const uniqueFriendIds = new Set<number>();
    for (const g of filteredGroups) {
      for (const m of g.members) {
        if (m.id !== swUser.id) uniqueFriendIds.add(m.id);
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      importedGroupCount: filteredGroups.length,
      stats,
      totals: {
        groups: filteredGroups.length,
        friends: uniqueFriendIds.size,
        expenses: stats.totalExpenses,
      },
      uninvitedMembers,
    });
  } catch (err) {
    console.error("[splitwise-import] fatal error:", err);
    const raw = err instanceof Error ? err.message : String(err);
    const isAuthError = /invalid.*token|unauthorized|401|403/i.test(raw);
    const isRateLimit = /rate.?limit|429|too many/i.test(raw);
    const userMessage = isAuthError
      ? "Splitwise connection expired. Please reconnect in Settings."
      : isRateLimit
      ? "Too many requests to Splitwise. Please try again in a few minutes."
      : "Import failed. Please try again.";
    return NextResponse.json({ error: userMessage }, { status: 500 });
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
  emailToClerkId: Map<string, string>,
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

  // Check if already imported BY THIS USER (scoped to owner_id for data isolation)
  const { data: existing } = await db
    .from("groups")
    .select("id")
    .eq("owner_id", userId)
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

  // 3b. Save Splitwise group avatar if the group has a custom one
  const avatarUrl = swGroup.custom_avatar
    ? (swGroup.avatar?.xlarge || swGroup.avatar?.large || swGroup.avatar?.medium || swGroup.avatar?.original || null)
    : null;
  if (avatarUrl) {
    const { error: imgErr } = await db
      .from("groups")
      .update({ image_url: avatarUrl })
      .eq("id", groupId);
    if (imgErr) console.warn(`[splitwise-import] group image update error for ${groupId}:`, imgErr.message);
  }

  // 4. Import members
  const swMemberIdToCoconutId = new Map<number, string>();

  for (const swMember of swGroup.members) {
    const isMe = swMember.id === swUserId;
    const rawEmail = isMe ? (myEmail ?? swMember.email) : swMember.email;
    const email = rawEmail?.trim().toLowerCase() || null;
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
      // Backfill user_id on existing rows that were previously unlinked
      if (!isMe && email) {
        const linkedId = emailToClerkId.get(email.toLowerCase());
        if (linkedId) {
          await db
            .from("group_members")
            .update({ user_id: linkedId })
            .eq("id", existingMember.id)
            .is("user_id", null);
        }
      }
      continue;
    }

    let memberUserId: string | null = null;
    if (isMe) {
      memberUserId = userId;
    } else if (email) {
      memberUserId = emailToClerkId.get(email.toLowerCase()) ?? null;
    }

    const { data: newMember, error } = await db
      .from("group_members")
      .insert({
        group_id: groupId,
        user_id: memberUserId,
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

  const isSettlement = (e: { payment?: boolean; description?: string; repayments?: unknown[] }) =>
    e.payment ||
    (e.description ?? "").toLowerCase().includes("settle all balances") ||
    (Array.isArray(e.repayments) && e.repayments.length > 0 && (e.description ?? "").toLowerCase().includes("settle"));
  const regularExpenses = expenses.filter((e) => !isSettlement(e));
  const settlements = expenses.filter((e) => isSettlement(e));
  stats.totalExpenses += regularExpenses.length;

  // Batch-check which expenses and settlements already exist FOR THIS USER'S GROUPS ONLY (parallel)
  const allExtIds = regularExpenses.map((e) => String(e.id));
  const existingExpenseIds = new Set<string>();
  const allSettlementRefs = settlements.map((e) => `splitwise:${e.id}`);
  const existingSettlementRefs = new Set<string>();

  const [expenseBatches, settlementBatches] = await Promise.all([
    allExtIds.length > 0
      ? Promise.all(
          Array.from({ length: Math.ceil(allExtIds.length / 500) }, (_, i) =>
            db.from("split_transactions")
              .select("external_id")
              .eq("source", "splitwise")
              .eq("group_id", groupId)
              .in("external_id", allExtIds.slice(i * 500, (i + 1) * 500))
              .then((r) => r.data ?? [])
          )
        )
      : Promise.resolve([]),
    allSettlementRefs.length > 0
      ? Promise.all(
          Array.from({ length: Math.ceil(allSettlementRefs.length / 500) }, (_, i) =>
            db.from("settlements")
              .select("external_reference")
              .eq("group_id", groupId)
              .in("external_reference", allSettlementRefs.slice(i * 500, (i + 1) * 500))
              .then((r) => r.data ?? [])
          )
        )
      : Promise.resolve([]),
  ]);
  for (const batch of expenseBatches) for (const row of batch) existingExpenseIds.add(row.external_id);
  for (const batch of settlementBatches) for (const row of batch) existingSettlementRefs.add(row.external_reference);

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
        notes: expense.details || null,
        category: expense.category?.name || null,
        receipt_url: expense.receipt?.large || expense.receipt?.original || null,
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
      await Promise.all(
        Array.from({ length: Math.ceil(allShares.length / 500) }, (_, j) =>
          db.from("split_shares").insert(allShares.slice(j * 500, (j + 1) * 500))
        )
      );
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
    await Promise.all(
      Array.from({ length: Math.ceil(settlementRows.length / 500) }, (_, i) =>
        db.from("settlements").insert(settlementRows.slice(i * 500, (i + 1) * 500))
      )
    );
  }
}

/** Parse a numeric string, returning null if the result is not finite. */
function safeParseFloat(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Individual importExpense/importSettlement removed — batched inline in importGroup above.
