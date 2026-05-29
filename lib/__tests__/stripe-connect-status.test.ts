import { describe, expect, it } from "vitest";
import { computeTransferEligibility } from "../stripe-connect-status";

describe("computeTransferEligibility", () => {
  it("returns none without account", () => {
    expect(
      computeTransferEligibility({
        hasAccount: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requiresVerification: false,
      }),
    ).toBe("none");
  });

  it("returns active when payouts enabled", () => {
    expect(
      computeTransferEligibility({
        hasAccount: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requiresVerification: false,
      }),
    ).toBe("active");
  });

  it("returns pending_review after info submitted but payouts off", () => {
    expect(
      computeTransferEligibility({
        hasAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        requiresVerification: false,
      }),
    ).toBe("pending_review");
  });

  it("returns action_required when verification due", () => {
    expect(
      computeTransferEligibility({
        hasAccount: true,
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
        requiresVerification: true,
      }),
    ).toBe("action_required");
  });
});
