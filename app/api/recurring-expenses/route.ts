export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { createRecurringExpense, processRecurringExpenses } from "@/lib/recurring-expenses";
import { rateLimit } from "@/lib/rate-limit";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data } = await db
    .from("recurring_expenses")
    .select("id, group_id, person_key, amount, description, frequency, next_due_date, is_active, created_at, iso_currency_code")
    .eq("clerk_user_id", userId)
    .eq("is_active", true)
    .order("next_due_date", { ascending: true });

  return NextResponse.json({ recurring: data ?? [] }, { headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" } });
}

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`recurring:${userId}`, 20, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const {
    action, groupId, personKey, amount, description, frequency, startDate,
    iso_currency_code, endDate, maxOccurrences, customIntervalDays,
  } = body as {
    action?: string;
    groupId?: string;
    personKey?: string;
    amount?: number;
    description?: string;
    frequency?: string;
    startDate?: string;
    iso_currency_code?: string;
    endDate?: string;
    maxOccurrences?: number;
    customIntervalDays?: number;
  };

  if (action === "process") {
    const created = await processRecurringExpenses(userId);
    if (created > 0) {
      revalidateTag(CACHE_TAGS.splitTransactions(userId), "max");
      revalidateTag(CACHE_TAGS.transactions(userId), "max");
    }
    return NextResponse.json({ processed: created });
  }

  if (!groupId || !amount || !description || !frequency) {
    return NextResponse.json({ error: "groupId, amount, description, frequency required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!["weekly", "biweekly", "monthly", "custom"].includes(frequency)) {
    return NextResponse.json({ error: "frequency must be weekly, biweekly, monthly, or custom" }, { status: 400 });
  }
  if (frequency === "custom" && (!customIntervalDays || customIntervalDays < 1)) {
    return NextResponse.json({ error: "customIntervalDays required for custom frequency" }, { status: 400 });
  }

  const result = await createRecurringExpense({
    clerkUserId: userId,
    groupId,
    personKey,
    amount,
    description,
    frequency: frequency as "weekly" | "biweekly" | "monthly" | "custom",
    startDate,
    isoCurrencyCode: iso_currency_code,
    endDate: endDate ?? null,
    maxOccurrences: maxOccurrences ?? null,
    customIntervalDays: customIntervalDays ?? null,
  });

  if (!result) return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  return NextResponse.json(result);
}
