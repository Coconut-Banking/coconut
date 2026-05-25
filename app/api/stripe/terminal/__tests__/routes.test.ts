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

  it("wallet GET compiles and exports", async () => {
    const mod = await import("../../wallet/route");
    expect(mod.GET).toBeDefined();
  });

  it("dashboard-link POST compiles and exports", async () => {
    const mod = await import("../../connect/dashboard-link/route");
    expect(mod.POST).toBeDefined();
  });

  it("create-payment-link POST compiles and exports", async () => {
    const mod = await import("../../create-payment-link/route");
    expect(mod.POST).toBeDefined();
  });
});
