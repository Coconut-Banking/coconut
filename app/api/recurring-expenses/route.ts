import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { createRecurringExpense, processRecurringExpenses } from "@/lib/recurring-expenses";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();
  const { data } = await db
    .from("recurring_expenses")
    .select("id, group_id, person_key, amount, description, frequency, next_due_date, is_active, created_at")
    .eq("clerk_user_id", userId)
    .eq("is_active", true)
    .order("next_due_date", { ascending: true });

  return NextResponse.json({ recurring: data ?? [] });
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
  const { action, groupId, personKey, amount, description, frequency, startDate } = body as {
    action?: string;
    groupId?: string;
    personKey?: string;
    amount?: number;
    description?: string;
    frequency?: string;
    startDate?: string;
  };

  if (action === "process") {
    const created = await processRecurringExpenses(userId);
    return NextResponse.json({ processed: created });
  }

  if (!groupId || !amount || !description || !frequency) {
    return NextResponse.json({ error: "groupId, amount, description, frequency required" }, { status: 400 });
  }
  if (!["weekly", "biweekly", "monthly"].includes(frequency)) {
    return NextResponse.json({ error: "frequency must be weekly, biweekly, or monthly" }, { status: 400 });
  }

  const result = await createRecurringExpense({
    clerkUserId: userId,
    groupId,
    personKey,
    amount,
    description,
    frequency: frequency as "weekly" | "biweekly" | "monthly",
    startDate,
  });

  if (!result) return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  return NextResponse.json(result);
}
