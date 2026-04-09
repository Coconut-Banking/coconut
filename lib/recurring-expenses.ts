/**
 * Recurring Expenses — auto-creates split expenses on schedule.
 * Called on app load / transaction sync to process any due recurring expenses.
 */

import { getSupabase } from "./supabase";
import { randomUUID } from "crypto";
import { computeEqualShares } from "./expense-shares";
import { normalizeSplitCurrency } from "./split-balances-currency";

interface RecurringRow {
  id: string;
  clerk_user_id: string;
  group_id: string;
  person_key: string | null;
  amount: number;
  description: string;
  frequency: "weekly" | "biweekly" | "monthly" | "custom";
  next_due_date: string;
  iso_currency_code?: string | null;
  end_date?: string | null;
  max_occurrences?: number | null;
  occurrences_created?: number | null;
  custom_interval_days?: number | null;
}

function addFrequency(date: string, frequency: string, customDays?: number | null): string {
  const d = new Date(date + "T12:00:00");
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "custom": d.setDate(d.getDate() + (customDays ?? 30)); break;
  }
  return d.toISOString().split("T")[0];
}

export async function processRecurringExpenses(clerkUserId: string): Promise<number> {
  const db = getSupabase();
  const today = new Date().toISOString().split("T")[0];

  const { data: due } = await db
    .from("recurring_expenses")
    .select("id, clerk_user_id, group_id, person_key, amount, description, frequency, next_due_date, iso_currency_code, end_date, max_occurrences, occurrences_created, custom_interval_days")
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true)
    .lte("next_due_date", today);

  if (!due?.length) return 0;

  // Pre-fetch all group members in one query to avoid N+1
  const allGroupIds = [...new Set((due as RecurringRow[]).map((r) => r.group_id))];
  const { data: allMembers } = await db
    .from("group_members")
    .select("id, user_id, group_id")
    .in("group_id", allGroupIds);
  const membersByGroup = new Map<string, { id: string; user_id: string | null; group_id: string }[]>();
  for (const m of allMembers ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }

  // Collect IDs that need deactivation so we can batch the update
  const deactivateIds: string[] = [];

  let created = 0;
  for (const rec of due as RecurringRow[]) {
    try {
      if (rec.end_date && today > rec.end_date) {
        deactivateIds.push(rec.id);
        continue;
      }
      if (rec.max_occurrences != null && (rec.occurrences_created ?? 0) >= rec.max_occurrences) {
        deactivateIds.push(rec.id);
        continue;
      }

      const txId = `manual_recurring_${randomUUID()}`;
      const currency = normalizeSplitCurrency(rec.iso_currency_code);

      // Insert transaction and return id in one round trip
      const { data: txRow, error: txErr } = await db.from("transactions").insert({
        clerk_user_id: rec.clerk_user_id,
        plaid_transaction_id: txId,
        date: rec.next_due_date,
        amount: -Math.abs(rec.amount),
        iso_currency_code: currency,
        raw_name: rec.description,
        merchant_name: rec.description,
        normalized_merchant: rec.description.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(),
        primary_category: "OTHER",
        is_pending: false,
      }).select("id").single();
      if (txErr || !txRow) {
        console.error("[recurring] tx insert failed:", txErr?.message);
        continue;
      }

      const members = membersByGroup.get(rec.group_id);
      if (!members?.length) continue;

      const payerMember = members.find((m) => m.user_id === rec.clerk_user_id);

      let splitRow: { id: string } | null = null;
      const { data: st1, error: e1 } = await db
        .from("split_transactions")
        .insert({
          group_id: rec.group_id,
          transaction_id: txRow.id,
          created_by: rec.clerk_user_id,
          payer_member_id: payerMember?.id ?? null,
          iso_currency_code: currency,
          date: rec.next_due_date,
        })
        .select("id")
        .single();
      if (e1 && e1.message?.includes("column")) {
        const { data: st2, error: e2 } = await db
          .from("split_transactions")
          .insert({
            group_id: rec.group_id,
            transaction_id: txRow.id,
            created_by: rec.clerk_user_id,
            payer_member_id: payerMember?.id ?? null,
            iso_currency_code: currency,
          })
          .select("id")
          .single();
        splitRow = st2;
        if (e2 || !splitRow) continue;
      } else if (e1 || !st1) {
        continue;
      } else {
        splitRow = st1;
      }

      if (rec.person_key) {
        const parts = rec.person_key.split("-");
        const memberId = parts.length >= 2 ? parts[parts.length - 1] : null;
        const targetMember = memberId ? members.find((m) => m.id === memberId) : null;
        const splitMemberIds = [payerMember, targetMember].filter(Boolean).map((m) => (m as { id: string }).id);
        const shares = computeEqualShares(Math.abs(rec.amount), splitMemberIds);
        if (shares.length > 0) {
          await db.from("split_shares").insert(shares.map((s) => ({
            split_transaction_id: splitRow.id,
            member_id: s.memberId,
            amount: s.amount,
          })));
        }
      } else {
        const memberIds = members.map((m) => m.id);
        const shares = computeEqualShares(Math.abs(rec.amount), memberIds);
        if (shares.length > 0) {
          await db.from("split_shares").insert(shares.map((s) => ({
            split_transaction_id: splitRow.id,
            member_id: s.memberId,
            amount: s.amount,
          })));
        }
      }

      const nextDue = addFrequency(rec.next_due_date, rec.frequency, rec.custom_interval_days);
      const newCount = (rec.occurrences_created ?? 0) + 1;
      const hitMax = rec.max_occurrences != null && newCount >= rec.max_occurrences;
      const pastEnd = rec.end_date != null && nextDue > rec.end_date;
      await db.from("recurring_expenses").update({
        next_due_date: nextDue,
        last_created_at: new Date().toISOString(),
        occurrences_created: newCount,
        ...(hitMax || pastEnd ? { is_active: false } : {}),
      }).eq("id", rec.id);

      created++;
    } catch (e) {
      console.error("[recurring] failed to create expense:", e instanceof Error ? e.message : e);
    }
  }

  // Batch-deactivate all expired/maxed-out recurring expenses in one update
  if (deactivateIds.length > 0) {
    await db.from("recurring_expenses").update({ is_active: false }).in("id", deactivateIds);
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
  frequency: "weekly" | "biweekly" | "monthly" | "custom";
  startDate?: string;
  isoCurrencyCode?: string | null;
  endDate?: string | null;
  maxOccurrences?: number | null;
  customIntervalDays?: number | null;
}): Promise<{ id: string } | null> {
  const db = getSupabase();
  const startDate = opts.startDate ?? addFrequency(
    new Date().toISOString().split("T")[0],
    opts.frequency,
    opts.customIntervalDays,
  );
  const currency = normalizeSplitCurrency(opts.isoCurrencyCode);

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
      iso_currency_code: currency,
      end_date: opts.endDate ?? null,
      max_occurrences: opts.maxOccurrences ?? null,
      custom_interval_days: opts.frequency === "custom" ? (opts.customIntervalDays ?? 30) : null,
      occurrences_created: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[recurring] create failed:", error.message);
    return null;
  }
  return data;
}
