import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabase();

  const [accountsResult, subsResult] = await Promise.all([
    db
      .from("accounts")
      .select("type, balance_current, iso_currency_code")
      .eq("clerk_user_id", effectiveUserId),
    db
      .from("subscriptions")
      .select("merchant_name, amount, frequency, next_due_date, primary_category")
      .eq("clerk_user_id", effectiveUserId)
      .eq("status", "active")
      .order("next_due_date", { ascending: true }),
  ]);

  // Net worth: assets (depository, investment, brokerage) minus liabilities (credit, loan)
  const accounts = accountsResult.data ?? [];
  const assetTypes = new Set(["depository", "investment", "brokerage", "other"]);
  const liabilityTypes = new Set(["credit", "loan"]);

  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const bal = Number(a.balance_current) || 0;
    const type = (a.type || "").toLowerCase();
    if (liabilityTypes.has(type)) {
      liabilities += Math.abs(bal);
    } else if (assetTypes.has(type)) {
      assets += bal;
    } else {
      assets += bal;
    }
  }

  // Upcoming bills: next 5 subscriptions by due date
  const subs = (subsResult.data ?? []).map((s) => ({
    merchant: s.merchant_name,
    amount: Number(s.amount) || 0,
    frequency: s.frequency,
    nextDue: s.next_due_date,
    category: (s.primary_category ?? "OTHER").replace(/_/g, " "),
  }));

  const totalMonthly = subs.reduce((acc, s) => {
    if (s.frequency === "monthly") return acc + s.amount;
    if (s.frequency === "yearly") return acc + s.amount / 12;
    if (s.frequency === "weekly") return acc + s.amount * 4.33;
    if (s.frequency === "biweekly") return acc + s.amount * 2.17;
    return acc + s.amount;
  }, 0);

  const upcomingBills = subs
    .filter((s) => s.nextDue)
    .slice(0, 5);

  return NextResponse.json({
    netWorth: { assets, liabilities, total: assets - liabilities },
    subscriptions: { totalMonthly, count: subs.length, upcomingBills },
  });
}
