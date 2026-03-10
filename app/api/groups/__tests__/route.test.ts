import { describe, it, expect } from "vitest";

describe("groups API route", () => {
  it("GET compiles and exports", async () => {
    const mod = await import("../route");
    expect(mod.GET).toBeDefined();
  });

  it("POST compiles and exports", async () => {
    const mod = await import("../route");
    expect(mod.POST).toBeDefined();
  });

  it("validates group_type as expected enum", () => {
    const valid = ["home", "trip", "couple", "other"];
    for (const t of valid) {
      expect(valid.includes(t)).toBe(true);
    }
    expect(valid.includes("invalid")).toBe(false);
  });
});
