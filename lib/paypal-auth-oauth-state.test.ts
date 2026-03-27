import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createOAuthState, verifyOAuthState } from "./paypal-auth";

describe("OAuth state (Splitwise mobile)", () => {
  const prev = process.env.TOKEN_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-key-at-least-32-chars-long!!";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = prev;
  });

  it("legacy 3-part state verifies without returnToApp", () => {
    const s = createOAuthState("user_1");
    expect(s.split(":")).toHaveLength(3);
    const v = verifyOAuthState(s);
    expect(v.valid).toBe(true);
    expect(v.userId).toBe("user_1");
    expect(v.returnToApp).toBeUndefined();
  });

  it("v2 state round-trips returnToApp and scheme key", () => {
    const s = createOAuthState("user_2", { returnToApp: true, appSchemeKey: "d" });
    expect(s.startsWith("v2:")).toBe(true);
    const v = verifyOAuthState(s);
    expect(v.valid).toBe(true);
    expect(v.userId).toBe("user_2");
    expect(v.returnToApp).toBe(true);
    expect(v.appSchemeKey).toBe("d");
  });

  it("rejects tampered v2 state", () => {
    const s = createOAuthState("user_3", { returnToApp: true });
    const tampered = s.replace(/app:p/, "app:d");
    const v = verifyOAuthState(tampered);
    expect(v.valid).toBe(false);
  });
});
