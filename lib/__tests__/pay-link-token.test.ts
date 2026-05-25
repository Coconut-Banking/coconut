import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPayLinkToken, verifyPayLinkToken } from "../pay-link-token";

describe("pay-link-token", () => {
  const prev = process.env.PAY_LINK_SIGNING_KEY;

  beforeEach(() => {
    process.env.PAY_LINK_SIGNING_KEY = "test-signing-key-32-bytes-long!!";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PAY_LINK_SIGNING_KEY;
    else process.env.PAY_LINK_SIGNING_KEY = prev;
  });

  it("round-trips a valid token", () => {
    const token = createPayLinkToken({
      groupId: "g1",
      payerMemberId: "p1",
      receiverMemberId: "r1",
      amount: 12.5,
      currency: "USD",
    });
    const verified = verifyPayLinkToken(token);
    expect(verified.valid).toBe(true);
    if (verified.valid) {
      expect(verified.payload.groupId).toBe("g1");
      expect(verified.payload.amount).toBe(12.5);
    }
  });

  it("rejects tampered tokens", () => {
    const token = createPayLinkToken({
      groupId: "g1",
      payerMemberId: "p1",
      receiverMemberId: "r1",
      amount: 5,
      currency: "USD",
    });
    const bad = token.slice(0, -2) + "xx";
    expect(verifyPayLinkToken(bad).valid).toBe(false);
  });
});
