import { describe, it, expect } from "vitest";
import { buildAccountSessionComponents } from "../stripe-connect-embedded";

describe("buildAccountSessionComponents", () => {
  it("enables onboarding only for onboarding mode", () => {
    const components = buildAccountSessionComponents("onboarding");
    expect(components.account_onboarding?.enabled).toBe(true);
    expect(components.account_onboarding?.features).toBeUndefined();
    expect(components.payouts).toBeUndefined();
  });

  it("enables payouts and balances for payouts mode", () => {
    const components = buildAccountSessionComponents("payouts");
    expect(components.payouts?.enabled).toBe(true);
    expect(components.balances?.enabled).toBe(true);
  });

  it("enables all primary components for all mode", () => {
    const components = buildAccountSessionComponents("all");
    expect(components.account_onboarding?.enabled).toBe(true);
    expect(components.payouts?.enabled).toBe(true);
    expect(components.payments?.enabled).toBe(true);
  });
});
