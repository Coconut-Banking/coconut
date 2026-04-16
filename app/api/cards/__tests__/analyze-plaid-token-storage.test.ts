/**
 * Tests for BUG-RESILIENCE-1: Second bank's Plaid access token permanently discarded.
 *
 * When a user connects a second bank in the /cards tool, analyze-plaid exchanges
 * a public token for a one-time-use access_token+item_id. In the merge branch
 * (existing session cookie present), the DB update previously only wrote
 * `spend_summary`, silently discarding the new token. When migrate-token ran at
 * signup, only the first bank's token existed in the DB.
 *
 * Fix: also write `plaid_access_token` (encrypted) and `plaid_item_id` in the
 * merge-branch DB update.
 *
 * NOTE: Full route integration testing with Vitest requires mocking several
 * heavy modules (Plaid SDK, Supabase client, Next.js cookies/headers). Instead,
 * we extract and test the logic that builds the DB update payload, and use a
 * lightweight simulation that mirrors what the route does. This is the same
 * pattern used by app/api/plaid/__tests__/exchange-token.test.ts.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal stubs matching the route's shape
// ---------------------------------------------------------------------------

type SpendSummary = {
  dining: number; travel: number; groceries: number; gas: number;
  streaming: number; transit: number; other: number; total: number;
  months_analyzed: number;
};

function mergeSpendSummaries(a: SpendSummary, b: SpendSummary): SpendSummary {
  return {
    dining: a.dining + b.dining,
    travel: a.travel + b.travel,
    groceries: a.groceries + b.groceries,
    gas: a.gas + b.gas,
    streaming: a.streaming + b.streaming,
    transit: a.transit + b.transit,
    other: a.other + b.other,
    total: a.total + b.total,
    months_analyzed: Math.max(a.months_analyzed, b.months_analyzed),
  };
}

/** Simulate encryptToken without requiring the crypto env to be set up. */
function encryptToken(plaintext: string): string {
  return `enc:${plaintext}`;
}

// ---------------------------------------------------------------------------
// Simulate the merge-branch DB update payload — BEFORE fix
// ---------------------------------------------------------------------------

function buildMergeUpdatePayloadBefore(
  finalSpendSummary: SpendSummary,
  // access_token and item_id are intentionally unused here — that's the bug
  _access_token: string,
  _item_id: string,
): Record<string, unknown> {
  // Old code: only spend_summary is written
  return { spend_summary: finalSpendSummary };
}

// ---------------------------------------------------------------------------
// Simulate the merge-branch DB update payload — AFTER fix
// ---------------------------------------------------------------------------

function buildMergeUpdatePayloadAfter(
  finalSpendSummary: SpendSummary,
  access_token: string,
  item_id: string,
): Record<string, unknown> {
  const encryptedToken = encryptToken(access_token);
  return {
    spend_summary: finalSpendSummary,
    plaid_access_token: encryptedToken,
    plaid_item_id: item_id,
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const existingSpend: SpendSummary = {
  dining: 100, travel: 50, groceries: 200, gas: 30,
  streaming: 20, transit: 10, other: 40, total: 450,
  months_analyzed: 3,
};

const newBankSpend: SpendSummary = {
  dining: 80, travel: 120, groceries: 150, gas: 0,
  streaming: 15, transit: 5, other: 30, total: 400,
  months_analyzed: 3,
};

const NEW_ACCESS_TOKEN = "access-sandbox-abc123";
const NEW_ITEM_ID = "item-sandbox-xyz789";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyze-plaid merge branch DB update (BUG-RESILIENCE-1)", () => {
  const merged = mergeSpendSummaries(existingSpend, newBankSpend);

  it("BEFORE fix: DB update payload is missing plaid_access_token and plaid_item_id", () => {
    const payload = buildMergeUpdatePayloadBefore(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);

    // spend_summary is present
    expect(payload).toHaveProperty("spend_summary");

    // BUG: token fields are absent — second bank token is silently discarded
    expect(payload).not.toHaveProperty("plaid_access_token");
    expect(payload).not.toHaveProperty("plaid_item_id");
  });

  it("AFTER fix: DB update payload includes plaid_access_token and plaid_item_id", () => {
    const payload = buildMergeUpdatePayloadAfter(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);

    // spend_summary still present
    expect(payload).toHaveProperty("spend_summary");

    // FIX: token fields are now included
    expect(payload).toHaveProperty("plaid_access_token");
    expect(payload).toHaveProperty("plaid_item_id");
  });

  it("AFTER fix: plaid_item_id matches the new bank's item_id exactly", () => {
    const payload = buildMergeUpdatePayloadAfter(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);
    expect(payload.plaid_item_id).toBe(NEW_ITEM_ID);
  });

  it("AFTER fix: plaid_access_token is the encrypted form of the new access_token", () => {
    const payload = buildMergeUpdatePayloadAfter(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);
    // encryptToken is applied — raw token is not stored
    expect(payload.plaid_access_token).toBe(`enc:${NEW_ACCESS_TOKEN}`);
    expect(payload.plaid_access_token).not.toBe(NEW_ACCESS_TOKEN);
  });

  it("AFTER fix: merged spend_summary sums both banks category-by-category", () => {
    const payload = buildMergeUpdatePayloadAfter(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);
    const summary = payload.spend_summary as SpendSummary;

    expect(summary.dining).toBe(existingSpend.dining + newBankSpend.dining);
    expect(summary.travel).toBe(existingSpend.travel + newBankSpend.travel);
    expect(summary.groceries).toBe(existingSpend.groceries + newBankSpend.groceries);
    expect(summary.total).toBe(existingSpend.total + newBankSpend.total);
  });

  it("AFTER fix: months_analyzed is the max of both banks", () => {
    const payload = buildMergeUpdatePayloadAfter(merged, NEW_ACCESS_TOKEN, NEW_ITEM_ID);
    const summary = payload.spend_summary as SpendSummary;
    expect(summary.months_analyzed).toBe(
      Math.max(existingSpend.months_analyzed, newBankSpend.months_analyzed)
    );
  });
});

// ---------------------------------------------------------------------------
// Verify the actual route source contains the fix
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { join } from "path";

const routeSrc = readFileSync(
  join(process.cwd(), "app/api/cards/analyze-plaid/route.ts"),
  "utf-8"
);

describe("analyze-plaid route source (BUG-RESILIENCE-1 static check)", () => {
  it("merge branch DB update includes plaid_access_token", () => {
    // Confirms the actual route file was patched, not just the simulation above
    expect(routeSrc).toContain("plaid_access_token: encryptedToken");
  });

  it("merge branch DB update includes plaid_item_id", () => {
    expect(routeSrc).toContain("plaid_item_id: item_id");
  });

  it("merge branch calls encryptToken before the DB update", () => {
    // encryptToken must be called within the merge branch
    // We verify both the call and that it precedes the update by checking
    // source order: encryptToken appears before the .update({ ... }) call in the merge block
    const mergeBlockStart = routeSrc.indexOf("// Update existing session with merged spend");
    const encryptCallPos = routeSrc.indexOf("encryptToken(access_token)", mergeBlockStart);
    const updateCallPos = routeSrc.indexOf(".update({", mergeBlockStart);

    expect(mergeBlockStart).toBeGreaterThan(-1);
    expect(encryptCallPos).toBeGreaterThan(mergeBlockStart);
    expect(updateCallPos).toBeGreaterThan(encryptCallPos);
  });
});
