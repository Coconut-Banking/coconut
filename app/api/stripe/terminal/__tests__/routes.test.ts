import { describe, it, expect } from "vitest";

describe("Stripe Terminal API routes", () => {
  it("connection-token POST compiles and exports", async () => {
    const mod = await import("../connection-token/route");
    expect(mod.POST).toBeDefined();
  });

  it("location GET compiles and exports", async () => {
    const mod = await import("../location/route");
    expect(mod.GET).toBeDefined();
  });

  it("create-payment-intent POST compiles and exports", async () => {
    const mod = await import("../create-payment-intent/route");
    expect(mod.POST).toBeDefined();
  });
});
