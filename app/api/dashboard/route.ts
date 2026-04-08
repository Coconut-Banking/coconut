export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseForUser } from "@/lib/supabase";
import { getEffectiveUserId } from "@/lib/demo";
import { convertCurrency } from "@/lib/currency";
import { getCachedSupabaseToken, loadClerkAuth } from "@/lib/auth";

export async function GET() {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effectiveUserId = await getEffectiveUserId({ userId: session.userId });
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = session.userId ? await getCachedSupabaseToken(session.getToken, session.userId) : null;
    const db = getSupabaseForUser(token) ?? getSupabaseAdmin();

    const [accountsResult, subsResult, walletsResult] = await Promise.all([
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
      db
        .from("manual_accounts")
        .select("id, name, platform, balance, iso_currency_code, updated_at")
        .eq("clerk_user_id", effectiveUserId)
        .order("created_at", { ascending: true }),
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
      const nativeBal =
        !isLiability && a.balance_available != null
          ? Number(a.balance_available)
          : Number(a.balance_current) || 0;
      const bal = convertCurrency(nativeBal, a.iso_currency_code ?? "USD", "USD");

      if (isLiability) {
        if (bal >= 0) {
          liabilities += bal;
        } else {
          // Negative balance on credit/loan = overpayment, treat as asset
          assets += Math.abs(bal);
        }
      } else {
        assets += bal;
      }
    }

    // Add manual P2P wallet balances to assets
    const manualAccounts = walletsResult.data ?? [];
    for (const w of manualAccounts) {
      const bal = Number(w.balance) || 0;
      const walletCurrency = ((w.iso_currency_code ?? "USD") as string).toUpperCase();
      assets += convertCurrency(bal, walletCurrency, "USD");
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
      if (s.frequency === "weekly") return acc + (s.amount * 52) / 12;
      if (s.frequency === "biweekly") return acc + (s.amount * 26) / 12;
      if (s.frequency === "semiannual") return acc + s.amount / 6;
      return acc + s.amount;
    }, 0);
    const totalMonthlyRounded = Math.round(totalMonthly * 100) / 100;

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

    const wallets = manualAccounts.map((w) => ({
      id: w.id as string,
      name: w.name as string,
      platform: w.platform as string,
      balance: Number(w.balance) || 0,
      iso_currency_code: (w.iso_currency_code ?? "USD") as string,
      updatedAt: (w.updated_at ?? null) as string | null,
    }));

    return NextResponse.json({
      netWorth: { assets, liabilities, total: assets - liabilities },
      subscriptions: { totalMonthly: totalMonthlyRounded, count: subs.length, upcomingBills },
      accounts: accountList,
      wallets,
    }, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (err) {
    console.error("[dashboard] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
