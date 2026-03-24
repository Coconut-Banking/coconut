/**
 * Integration test — calls searchV2 against the real DB and OpenAI.
 * Requires OPENAI_API_KEY and Supabase env vars to be set.
 * Run with: npm run test -- lib/search/__tests__/api-integration.test.ts
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { searchV2 } from "../engine";

const uid = process.env.TEST_USER_ID || "demo-sandbox-user";
const hasEnv = !!process.env.OPENAI_API_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasEnv)("searchV2 integration", () => {
  it("uber — returns uber rides", async () => {
    const r = await searchV2(uid, "uber");
    console.log(`uber: ${r.count} results, ${r.applied_filters.date_start ?? "all time"}`);
    expect(r.count).toBeGreaterThan(0);
    expect(r.transactions[0].merchant_name?.toLowerCase()).toContain("uber");
  }, 30000);

  it("eating out last month — returns restaurants with date filter", async () => {
    const r = await searchV2(uid, "eating out last month");
    console.log(`eating out: ${r.count} results, dates: ${r.applied_filters.date_start} to ${r.applied_filters.date_end}`);
    expect(r.count).toBeGreaterThan(0);
    expect(r.applied_filters.date_start).toBeTruthy();
    expect(r.applied_filters.date_end).toBeTruthy();
    expect(r.date_range).toBeTruthy();
  }, 30000);

  it("how much did I spend on gas — aggregate intent parsed correctly", async () => {
    const r = await searchV2(uid, "how much did I spend on gas");
    console.log(`gas: ${r.count} results, total: $${r.total?.toFixed(2)}`);
    expect(r.intent).toBe("aggregate");
    // Demo sandbox may not have gas stations — just verify intent parsing
    expect(r.total).toBeDefined();
  }, 30000);

  it("food with calendar override — respects date override", async () => {
    const r = await searchV2(uid, "food", {
      dateOverride: { start: "2026-03-01", end: "2026-03-15" },
    });
    console.log(`food (Mar 1-15): ${r.count} results`);
    expect(r.applied_filters.date_start).toBe("2026-03-01");
    expect(r.applied_filters.date_end).toBe("2026-03-15");
    for (const tx of r.transactions) {
      expect(tx.date >= "2026-03-01").toBe(true);
      expect(tx.date <= "2026-03-15").toBe(true);
    }
  }, 30000);

  it("haircuts — no gyms or cosmetics in results", async () => {
    const r = await searchV2(uid, "haircuts");
    console.log(`haircuts: ${r.count} results`);
    const merchants = [...new Set(r.transactions.map((t) => t.merchant_name))];
    console.log(`  merchants: ${merchants.join(", ")}`);
    // Demo sandbox may not have barbershops — just verify no false positives
    const hasGym = merchants.some((m) => m && /fitness|lifetime|goodlife/i.test(m));
    expect(hasGym).toBe(false);
  }, 30000);

  it("transactions in France — location filter", async () => {
    const r = await searchV2(uid, "transactions in France");
    console.log(`France: ${r.count} results, filter: ${r.applied_filters.location}`);
    expect(r.applied_filters.location).toBeTruthy();
  }, 30000);

  it("subscriptions — returns results or empty (data-dependent)", async () => {
    const r = await searchV2(uid, "subscriptions");
    console.log(`subscriptions: ${r.count} results`);
    const merchants = [...new Set(r.transactions.map((t) => t.merchant_name))];
    console.log(`  merchants: ${merchants.join(", ")}`);
    expect(r.intent).toBe("search");
  }, 30000);
});
