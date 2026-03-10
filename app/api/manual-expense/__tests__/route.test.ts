import { describe, it, expect } from "vitest";

describe("manual-expense API route", () => {
  it("POST compiles and exports", async () => {
    const mod = await import("../route");
    expect(mod.POST).toBeDefined();
  });
});
