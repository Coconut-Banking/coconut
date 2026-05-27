import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCollectLinkToken, verifyCollectLinkToken } from "../collect-link-token";

describe("collect-link-token", () => {
  const prev = process.env.PAY_LINK_SIGNING_KEY;

  beforeEach(() => {
    process.env.PAY_LINK_SIGNING_KEY = "test-collect-key";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PAY_LINK_SIGNING_KEY;
    else process.env.PAY_LINK_SIGNING_KEY = prev;
  });

  it("round-trips a valid token", () => {
    const token = createCollectLinkToken("session-uuid");
    const v = verifyCollectLinkToken(token);
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.payload.sessionId).toBe("session-uuid");
  });
});
