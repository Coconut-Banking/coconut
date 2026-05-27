import { describe, it, expect } from "vitest";
import { computeWalletDisplay } from "../stripe-wallet-response";

describe("computeWalletDisplay", () => {
  it("shows platform-held balance before Connect setup", () => {
    const wallet = computeWalletDisplay({
      currency: "USD",
      coconutHeld: 42.5,
      stripeAvailable: null,
      stripePending: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      hasAccount: false,
    });
    expect(wallet.available).toBe(42.5);
    expect(wallet.totalCollected).toBe(42.5);
    expect(wallet.canCashOut).toBe(false);
    expect(wallet.canSetupPayouts).toBe(true);
  });

  it("shows Connect available after setup and keeps platform-held visible", () => {
    const wallet = computeWalletDisplay({
      currency: "USD",
      coconutHeld: 15,
      stripeAvailable: 30,
      stripePending: 5,
      chargesEnabled: true,
      payoutsEnabled: true,
      hasAccount: true,
    });
    expect(wallet.available).toBe(30);
    expect(wallet.pending).toBe(5);
    expect(wallet.totalCollected).toBe(50);
    expect(wallet.canCashOut).toBe(true);
    expect(wallet.canSetupPayouts).toBe(false);
  });

  it("blocks cash out until payouts are enabled", () => {
    const wallet = computeWalletDisplay({
      currency: "USD",
      coconutHeld: 0,
      stripeAvailable: 20,
      stripePending: 0,
      chargesEnabled: true,
      payoutsEnabled: false,
      hasAccount: true,
    });
    expect(wallet.canCashOut).toBe(false);
    expect(wallet.canSetupPayouts).toBe(true);
  });
});
