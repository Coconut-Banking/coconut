import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";

export async function GET() {
  const effectiveUserId = await getEffectiveUserId();
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    const [accountsResult, subsResult] = await Promise.all([
      db
        .from("accounts")
        .select("name, type, subtype, mask, balance_current, balance_available, iso_currency_code")
        .eq("clerk_user_id", effectiveUserId),
      db
        .from("subscriptions")
        .select("merchant_name, amount, frequency, next_due_date, primary_category")
        .eq("clerk_user_id", effectiveUserId)
        .eq("status", "active")
        .order("next_due_date", { ascending: true }),
    ]);

    // Deduplicate accounts — same name+mask can appear from sandbox + production items
    const rawAccounts = accountsResult.data ?? [];
    const seen = new Map<string, (typeof rawAccounts)[number]>();
    for (const a of rawAccounts) {
      const key = `${a.name ?? ""}|${a.mask ?? ""}`;
      if (!seen.has(key)) seen.set(key, a);
    }
    const accounts = [...seen.values()];

    // Net worth: assets minus liabilities
    // Plaid stores balance_current as positive for all account types:
    //   depository/investment: positive = money you have
    //   credit/loan: positive = money you owe
    const liabilityTypes = new Set(["credit", "loan"]);

    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      const type = (a.type || "").toLowerCase();
      const isLiability = liabilityTypes.has(type);

      // For depository, prefer balance_available (excludes pending debits)
      const bal =
        !isLiability && a.balance_available != null
          ? Number(a.balance_available)
          : Number(a.balance_current) || 0;

      if (isLiability) {
        liabilities += Math.abs(bal);
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
      if (s.frequency === "quarterly") return acc + s.amount / 3;
      if (s.frequency === "weekly") return acc + s.amount * 4.33;
      if (s.frequency === "biweekly") return acc + s.amount * 2.17;
      if (s.frequency === "semiannual") return acc + s.amount / 6;
      return acc + s.amount;
    }, 0);

    const upcomingBills = subs
      .filter((s) => s.nextDue)
      .slice(0, 5);

    const accountList = accounts.map((a) => {
      const type = (a.type || "").toLowerCase();
      const isLiability = liabilityTypes.has(type);
      const bal =
        !isLiability && a.balance_available != null
          ? Number(a.balance_available)
          : Number(a.balance_current) || 0;
      return {
        name: a.name ?? "Account",
        type: a.type ?? "depository",
        subtype: a.subtype ?? null,
        mask: a.mask ?? null,
        balance: bal,
        isLiability,
        iso_currency_code: a.iso_currency_code ?? "USD",
      };
    });

    return NextResponse.json({
      netWorth: { assets, liabilities, total: assets - liabilities },
      subscriptions: { totalMonthly, count: subs.length, upcomingBills },
      accounts: accountList,
    });
  } catch (err) {
    console.error("[dashboard] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
