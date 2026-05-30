import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLinkSigningKey } from "../link-signing-key";

describe("resolveLinkSigningKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers dedicated key", () => {
    expect(resolveLinkSigningKey("dedicated-key", ["TOKEN_ENCRYPTION_KEY"])).toBe(
      "dedicated-key",
    );
  });

  it("uses TOKEN_ENCRYPTION_KEY in production when dedicated unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "enc-key-32-chars-minimum-length!!");
    expect(resolveLinkSigningKey(undefined, ["TOKEN_ENCRYPTION_KEY", "CLERK_SECRET_KEY"])).toBe(
      "enc-key-32-chars-minimum-length!!",
    );
  });

  it("does not use CLERK_SECRET_KEY in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_clerk");
    expect(() =>
      resolveLinkSigningKey(undefined, ["CLERK_SECRET_KEY"]),
    ).toThrow(/missing/i);
  });

  it("allows CLERK_SECRET_KEY fallback in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_clerk");
    expect(resolveLinkSigningKey(undefined, ["CLERK_SECRET_KEY"])).toBe("sk_test_clerk");
  });
});
