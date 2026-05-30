import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("encryption", () => {
  const env = process.env;
  const testKeyHex = "a".repeat(64);

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env, TOKEN_ENCRYPTION_KEY: testKeyHex };
  });

  afterEach(() => {
    process.env = env;
    vi.resetModules();
  });

  it("round-trips with a valid 32-byte hex key", async () => {
    const { encryptToken, decryptToken } = await import("../encryption");
    const plain = "access-sandbox-test-token";
    const encrypted = encryptToken(plain);
    expect(encrypted).not.toBe(plain);
    expect(decryptToken(encrypted)).toBe(plain);
  });

  it("allows plaintext passthrough in development without key", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const { encryptToken, decryptToken } = await import("../encryption");
    const plain = "dev-only-token";
    expect(encryptToken(plain)).toBe(plain);
    expect(decryptToken(plain)).toBe(plain);
    vi.unstubAllEnvs();
  });

  it("throws on encrypt in production without key", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const { encryptToken } = await import("../encryption");
    expect(() => encryptToken("secret")).toThrow(/TOKEN_ENCRYPTION_KEY is required/);
    vi.unstubAllEnvs();
  });

  it("throws on decrypt in production without key", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const { decryptToken } = await import("../encryption");
    expect(() => decryptToken("anything")).toThrow(/TOKEN_ENCRYPTION_KEY is required/);
    vi.unstubAllEnvs();
  });
});
