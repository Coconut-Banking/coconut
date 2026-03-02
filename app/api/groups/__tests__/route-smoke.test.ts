import { describe, it, expect } from "vitest";

/**
 * Smoke test: ensures the groups API route module compiles and exports.
 * Catches redeclaration and other build errors.
 */
describe("groups API route", () => {
  it("compiles without errors", async () => {
    const mod = await import("../[id]/route");
    expect(mod.GET).toBeDefined();
  });
});
