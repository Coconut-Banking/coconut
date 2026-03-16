/**
 * Recurring Expenses — auto-creates split expenses on schedule.
 * Called on app load / transaction sync to process any due recurring expenses.
 */

import { getSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { computeEqualShares } from "./expense-shares";

interface RecurringRow {
  id: string;
  clerk_user_id: string;
  group_id: string;
  person_key: string | null;
  amount: number;
  description: string;
  frequency: "weekly" | "biweekly" | "monthly";
  next_due_date: string;
}

function addFrequency(date: string, frequency: string): string {
  const d = new Date(date + "T12:00:00");
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

export async function processRecurringExpenses(clerkUserId: string): Promise<number> {
  const db = getSupabase();
  const today = new Date().toISOString().split("T")[0];

  const { data: due } = await db
    .from("recurring_expenses")
    .select("id, clerk_user_id, group_id, person_key, amount, description, frequency, next_due_date")
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true)
    .lte("next_due_date", today);

  if (!due?.length) return 0;

  let created = 0;
  for (const rec of due as RecurringRow[]) {
    try {
      const txId = `manual_recurring_${randomUUID()}`;

      const { error: txErr } = await db.from("transactions").insert({
        clerk_user_id: rec.clerk_user_id,
        plaid_transaction_id: txId,
        date: rec.next_due_date,
        amount: -Math.abs(rec.amount),
        iso_currency_code: "USD",
        raw_name: rec.description,
        merchant_name: rec.description,
        normalized_merchant: rec.description.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(),
        primary_category: "OTHER",
        is_pending: false,
      });
      if (txErr) { console.error("[recurring] tx insert failed:", txErr.message); continue; }

      const { data: txRow } = await db
        .from("transactions")
        .select("id")
        .eq("plaid_transaction_id", txId)
        .single();
      if (!txRow) continue;

      const { data: members } = await db
        .from("group_members")
        .select("id, user_id")
        .eq("group_id", rec.group_id);
      if (!members?.length) continue;

      const payerMember = members.find((m: { user_id: string | null }) => m.user_id === rec.clerk_user_id);

      const { data: splitRow, error: splitErr } = await db
        .from("split_transactions")
        .insert({
          group_id: rec.group_id,
          transaction_id: txRow.id,
          created_by: rec.clerk_user_id,
          payer_member_id: payerMember?.id ?? null,
        })
        .select("id")
        .single();
      if (splitErr || !splitRow) continue;

      if (rec.person_key) {
        const parts = rec.person_key.split("-");
        const memberId = parts.length >= 2 ? parts[parts.length - 1] : null;
        const targetMember = memberId ? members.find((m: { id: string }) => m.id === memberId) : null;
        const splitMemberIds = [payerMember, targetMember].filter(Boolean).map((m) => (m as { id: string }).id);
        const shares = computeEqualShares(Math.abs(rec.amount), splitMemberIds);
        for (const s of shares) {
          await db.from("split_shares").insert({
            split_transaction_id: splitRow.id,
            member_id: s.memberId,
            amount: s.amount,
          });
        }
      } else {
        const memberIds = members.map((m: { id: string }) => m.id);
        const shares = computeEqualShares(Math.abs(rec.amount), memberIds);
        for (const s of shares) {
          await db.from("split_shares").insert({
            split_transaction_id: splitRow.id,
            member_id: s.memberId,
            amount: s.amount,
          });
        }
      }

      const nextDue = addFrequency(rec.next_due_date, rec.frequency);
      await db.from("recurring_expenses").update({
        next_due_date: nextDue,
        last_created_at: new Date().toISOString(),
      }).eq("id", rec.id);

      created++;
    } catch (e) {
      console.error("[recurring] failed to create expense:", e instanceof Error ? e.message : e);
    }
  }

  if (created > 0) {
    console.log(`[recurring] created ${created} recurring expense(s) for ${clerkUserId}`);
  }
  return created;
}

export async function createRecurringExpense(opts: {
  clerkUserId: string;
  groupId: string;
  personKey?: string;
  amount: number;
  description: string;
  frequency: "weekly" | "biweekly" | "monthly";
  startDate?: string;
}): Promise<{ id: string } | null> {
  const db = getSupabase();
  const startDate = opts.startDate ?? addFrequency(new Date().toISOString().split("T")[0], opts.frequency);

  const { data, error } = await db
    .from("recurring_expenses")
    .insert({
      clerk_user_id: opts.clerkUserId,
      group_id: opts.groupId,
      person_key: opts.personKey ?? null,
      amount: opts.amount,
      description: opts.description,
      frequency: opts.frequency,
      next_due_date: startDate,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[recurring] create failed:", error.message);
    return null;
  }
  return data;
}
