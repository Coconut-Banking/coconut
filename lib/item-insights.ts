/**
 * Item-Level Insights
 *
 * Analyzes receipt line items to surface granular purchasing patterns:
 * - Repeat purchases (items bought 3+ times this month)
 * - High-spend items (single items > $50)
 * - Merchant sub-category breakdown (for merchants with 3+ receipts)
 */

import { getSupabase } from "./supabase";

export interface ItemInsight {
  type: "repeat_purchase" | "high_spend_item" | "merchant_breakdown";
  message: string;
  detail?: string;
}

interface LineItem {
  name?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
  price?: number;
  category?: string;
}

interface ReceiptRow {
  merchant: string | null;
  line_items: unknown;
  date: string | null;
}

function normalizeItemName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function fmt(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export async function detectItemTrends(
  clerkUserId: string
): Promise<ItemInsight[]> {
  const db = getSupabase();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const { data, error } = await db
    .from("email_receipts")
    .select("merchant, line_items, date")
    .eq("clerk_user_id", clerkUserId)
    .gte("date", monthStart);

  if (error) {
    console.error("[item-insights] query failed:", error);
    return [];
  }

  if (!data?.length) return [];
  const receipts = data as ReceiptRow[];

  // Track items across all receipts
  const itemAgg = new Map<string, { count: number; total: number; merchants: Set<string> }>();
  // Track high-spend individual items
  const highSpendItems: Array<{ name: string; merchant: string; price: number }> = [];
  // Track receipts per merchant for breakdown
  const merchantReceipts = new Map<string, { count: number; categories: Map<string, number> }>();

  for (const receipt of receipts) {
    const merchant = (receipt.merchant || "Unknown").trim();
    const items = Array.isArray(receipt.line_items) ? (receipt.line_items as LineItem[]) : [];

    // Merchant receipt count
    if (!merchantReceipts.has(merchant)) {
      merchantReceipts.set(merchant, { count: 0, categories: new Map() });
    }
    const mr = merchantReceipts.get(merchant)!;
    mr.count++;

    for (const item of items) {
      const rawName = item.name;
      if (!rawName || typeof rawName !== "string") continue;

      const normalized = normalizeItemName(rawName);
      if (!normalized) continue;

      const quantity = Number(item.quantity) || 1;
      const itemTotal = Number(item.total) || Number(item.price) || Number(item.unit_price) || 0;

      // Aggregate by item name
      const existing = itemAgg.get(normalized) ?? { count: 0, total: 0, merchants: new Set() };
      existing.count += quantity;
      existing.total += itemTotal;
      existing.merchants.add(merchant);
      itemAgg.set(normalized, existing);

      // High-spend check (per-item total, not quantity-adjusted unit price)
      if (itemTotal > 50) {
        highSpendItems.push({ name: rawName.trim(), merchant, price: itemTotal });
      }

      // Merchant category breakdown
      const cat = (item.category || "other").trim().toLowerCase();
      mr.categories.set(cat, (mr.categories.get(cat) ?? 0) + itemTotal);
    }
  }

  const insights: ItemInsight[] = [];

  // 1. Repeat purchases (3+ times this month)
  const repeats = Array.from(itemAgg.entries())
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [name, data] of repeats.slice(0, 2)) {
    const displayName = name.length > 40 ? name.slice(0, 37) + "..." : name;
    insights.push({
      type: "repeat_purchase",
      message: `You've bought ${displayName} ${data.count} times this month (${fmt(data.total)})`,
      detail: data.merchants.size > 1
        ? `Across ${data.merchants.size} merchants`
        : `At ${Array.from(data.merchants)[0]}`,
    });
  }

  // 2. High-spend items (> $50)
  const sortedHighSpend = highSpendItems.sort((a, b) => b.price - a.price);
  for (const item of sortedHighSpend.slice(0, 2)) {
    insights.push({
      type: "high_spend_item",
      message: `Big purchase: ${item.name} at ${item.merchant} (${fmt(item.price)})`,
    });
  }

  // 3. Merchant sub-category breakdown (3+ receipts)
  const merchantBreakdowns = Array.from(merchantReceipts.entries())
    .filter(([, v]) => v.count >= 3 && v.categories.size > 1)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [merchant, data] of merchantBreakdowns.slice(0, 1)) {
    const totalSpend = Array.from(data.categories.values()).reduce((s, v) => s + v, 0);
    if (totalSpend <= 0) continue;

    const breakdown = Array.from(data.categories.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, amount]) => {
        const pct = Math.round((amount / totalSpend) * 100);
        return `${pct}% ${cat}`;
      })
      .join(", ");

    insights.push({
      type: "merchant_breakdown",
      message: `Your ${merchant} spending: ${breakdown}`,
      detail: `${data.count} receipts this month`,
    });
  }

  // Return max 3, prioritized: repeats first, then breakdowns, then high-spend
  const prioritized: ItemInsight[] = [
    ...insights.filter((i) => i.type === "repeat_purchase"),
    ...insights.filter((i) => i.type === "merchant_breakdown"),
    ...insights.filter((i) => i.type === "high_spend_item"),
  ];

  return prioritized.slice(0, 3);
}
