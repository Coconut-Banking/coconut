import { describe, it, expect } from "vitest";

/**
 * Tests for Plaid disconnect flow.
 */
describe("plaid disconnect route", () => {
  it("disconnect route module compiles and exports POST", async () => {
    const mod = await import("../disconnect/route");
    expect(mod.POST).toBeDefined();
    expect(typeof mod.POST).toBe("function");
  });

  it("filters manual_ transactions from bank delete list", () => {
    const all = [
      { id: "a", plaid_transaction_id: "plaid_1" },
      { id: "b", plaid_transaction_id: "manual_xyz" },
    ];
    const bankIds = all
      .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
      .map((r) => r.id);
    expect(bankIds).toEqual(["a"]);
  });
});
