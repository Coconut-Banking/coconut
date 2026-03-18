/**
 * Proactive Insights Engine
 *
 * Analyzes a user's transactions to surface actionable insights:
 * - Anomaly detection (unusual amounts at known merchants)
 * - Spending trend alerts (category spend vs historical average)
 * - Duplicate/double charge detection
 * - Subscription price changes
 */

import { getSupabase } from "./supabase";

export interface Insight {
  type: "anomaly" | "trend_up" | "trend_down" | "duplicate" | "price_change";
  severity: "info" | "warning" | "alert";
  title: string;
  description: string;
  transactions?: Array<{ id: string; merchant: string; amount: number; date: string }>;
  metadata?: Record<string, unknown>;
}

interface TxRow {
  id: string;
  merchant_name: string | null;
  raw_name: string | null;
  normalized_merchant: string | null;
  amount: number;
  date: string;
  primary_category: string | null;
}

function fmt(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function detectAnomalies(userId: string, db: ReturnType<typeof getSupabase>): Promise<Insight[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, normalized_merchant, amount, date, primary_category")
    .eq("clerk_user_id", userId)
    .lt("amount", 0)
    .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
    .order("date", { ascending: false })
    .limit(2000);

  if (!data?.length) return [];
  const rows = data as TxRow[];

  const byMerchant = new Map<string, number[]>();
  for (const r of rows) {
    const key = (r.normalized_merchant || r.merchant_name || "").trim().toLowerCase();
    if (!key) continue;
    const arr = byMerchant.get(key) ?? [];
    arr.push(Math.abs(r.amount));
    byMerchant.set(key, arr);
  }

  const insights: Insight[] = [];
  for (const r of rows) {
    const key = (r.normalized_merchant || r.merchant_name || "").trim().toLowerCase();
    const amounts = byMerchant.get(key);
    if (!amounts || amounts.length < 3) continue;
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length);
    if (stdDev < 2) continue;
    const z = (Math.abs(r.amount) - mean) / stdDev;
    if (z > 2.5) {
      insights.push({
        type: "anomaly",
        severity: z > 3.5 ? "alert" : "warning",
        title: `Unusual charge at ${r.merchant_name || r.raw_name}`,
        description: `${fmt(r.amount)} on ${r.date} is ${z.toFixed(1)}x your typical ${fmt(mean)} there.`,
        transactions: [{ id: r.id, merchant: r.merchant_name || r.raw_name || "", amount: r.amount, date: r.date }],
        metadata: { zScore: z, mean, stdDev },
      });
    }
  }
  return insights.slice(0, 5);
}

async function detectDuplicates(userId: string, db: ReturnType<typeof getSupabase>): Promise<Insight[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data } = await db
    .from("transactions")
    .select("id, merchant_name, raw_name, normalized_merchant, amount, date")
    .eq("clerk_user_id", userId)
    .lt("amount", 0)
    .gte("date", sevenDaysAgo.toISOString().split("T")[0])
    .order("date", { ascending: false })
    .limit(500);

  if (!data?.length) return [];
  const rows = data as TxRow[];
  const insights: Insight[] = [];
  const seen = new Map<string, TxRow>();

  for (const r of rows) {
    const key = `${(r.normalized_merchant || "").trim()}|${r.amount}`;
    const prev = seen.get(key);
    if (prev) {
      const d1 = new Date(prev.date).getTime();
      const d2 = new Date(r.date).getTime();
      if (Math.abs(d1 - d2) < 48 * 60 * 60 * 1000) {
        insights.push({
          type: "duplicate",
          severity: "warning",
          title: `Possible duplicate charge at ${r.merchant_name || r.raw_name}`,
          description: `Two charges of ${fmt(r.amount)} within 48 hours (${prev.date} and ${r.date}).`,
          transactions: [
            { id: prev.id, merchant: prev.merchant_name || prev.raw_name || "", amount: prev.amount, date: prev.date },
            { id: r.id, merchant: r.merchant_name || r.raw_name || "", amount: r.amount, date: r.date },
          ],
        });
      }
    }
    seen.set(key, r);
  }
  return insights.slice(0, 3);
}

async function detectSpendingTrends(userId: string, db: ReturnType<typeof getSupabase>): Promise<Insight[]> {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];

  const [{ data: thisMonth }, { data: lastMonth }] = await Promise.all([
    db.from("transactions").select("primary_category, amount").eq("clerk_user_id", userId).lt("amount", 0).gte("date", thisMonthStart),
    db.from("transactions").select("primary_category, amount").eq("clerk_user_id", userId).lt("amount", 0).gte("date", lastMonthStart).lte("date", lastMonthEnd),
  ]);

  if (!thisMonth?.length || !lastMonth?.length) return [];

  const sumByCategory = (rows: Array<{ primary_category: string | null; amount: number }>) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const cat = r.primary_category || "OTHER";
      map.set(cat, (map.get(cat) ?? 0) + Math.abs(r.amount));
    }
    return map;
  };

  const thisCats = sumByCategory(thisMonth as Array<{ primary_category: string | null; amount: number }>);
  const lastCats = sumByCategory(lastMonth as Array<{ primary_category: string | null; amount: number }>);

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectionFactor = daysInMonth / dayOfMonth;

  const insights: Insight[] = [];
  for (const [cat, thisTotal] of thisCats) {
    const lastTotal = lastCats.get(cat);
    if (!lastTotal || lastTotal < 20) continue;
    const projected = thisTotal * projectionFactor;
    const changePercent = ((projected - lastTotal) / lastTotal) * 100;

    if (changePercent > 40 && projected - lastTotal > 30) {
      insights.push({
        type: "trend_up",
        severity: changePercent > 80 ? "warning" : "info",
        title: `${cat.replace(/_/g, " ")} spending is up`,
        description: `On track to spend ${fmt(projected)} this month vs ${fmt(lastTotal)} last month (+${changePercent.toFixed(0)}%).`,
        metadata: { category: cat, projected, lastTotal, changePercent },
      });
    } else if (changePercent < -30 && lastTotal - projected > 30) {
      insights.push({
        type: "trend_down",
        severity: "info",
        title: `${cat.replace(/_/g, " ")} spending is down`,
        description: `On track for ${fmt(projected)} this month vs ${fmt(lastTotal)} last month (${changePercent.toFixed(0)}%).`,
        metadata: { category: cat, projected, lastTotal, changePercent },
      });
    }
  }

  return insights.sort((a, b) => {
    const aChange = Math.abs((a.metadata?.changePercent as number) ?? 0);
    const bChange = Math.abs((b.metadata?.changePercent as number) ?? 0);
    return bChange - aChange;
  }).slice(0, 3);
}

export async function generateInsights(userId: string): Promise<Insight[]> {
  const db = getSupabase();

  const results = await Promise.allSettled([
    detectAnomalies(userId, db),
    detectDuplicates(userId, db),
    detectSpendingTrends(userId, db),
  ]);

  const anomalies = results[0].status === "fulfilled" ? results[0].value : [];
  const duplicates = results[1].status === "fulfilled" ? results[1].value : [];
  const trends = results[2].status === "fulfilled" ? results[2].value : [];

  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      const names = ["anomalies", "duplicates", "trends"];
      console.error(`[insights] ${names[idx]} detector failed:`, result.reason);
    }
  });

  return [
    ...duplicates,
    ...anomalies,
    ...trends,
  ];
}
