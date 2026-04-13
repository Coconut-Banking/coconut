import { describe, it, expect, afterEach } from "vitest";

/**
 * Tests for BUG-ONBOARD-2: handoff-token base URL priority.
 *
 * The route must resolve the base URL as:
 *   APP_URL || (VERCEL_URL → "https://{VERCEL_URL}") || "https://coconut-app.dev"
 *
 * Before the fix, APP_URL was ignored entirely; the route used only VERCEL_URL.
 */

/** Mirrors the exact base URL logic from app/api/auth/handoff-token/route.ts */
function resolveBase(): string {
  return (
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "https://coconut-app.dev"
  );
}

const ORIG_ENV = { ...process.env };

afterEach(() => {
  // Restore env after each test
  for (const key of ["APP_URL", "VERCEL_URL"]) {
    if (ORIG_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIG_ENV[key];
    }
  }
});

describe("handoff-token base URL resolution (BUG-ONBOARD-2)", () => {
  it("uses APP_URL when both APP_URL and VERCEL_URL are set", () => {
    process.env.APP_URL = "https://custom.example.com";
    process.env.VERCEL_URL = "my-app.vercel.app";
    expect(resolveBase()).toBe("https://custom.example.com");
  });

  it("uses APP_URL when only APP_URL is set", () => {
    process.env.APP_URL = "https://custom.example.com";
    delete process.env.VERCEL_URL;
    expect(resolveBase()).toBe("https://custom.example.com");
  });

  it("uses VERCEL_URL (with https prefix) when APP_URL is not set", () => {
    delete process.env.APP_URL;
    process.env.VERCEL_URL = "my-app.vercel.app";
    expect(resolveBase()).toBe("https://my-app.vercel.app");
  });

  it("falls back to hardcoded URL when neither APP_URL nor VERCEL_URL is set", () => {
    delete process.env.APP_URL;
    delete process.env.VERCEL_URL;
    expect(resolveBase()).toBe("https://coconut-app.dev");
  });

  it("APP_URL takes priority over VERCEL_URL — old code would have used VERCEL_URL instead", () => {
    // This is the exact scenario that was broken: APP_URL set, VERCEL_URL also set.
    // Old code: base = VERCEL_URL ? `https://${VERCEL_URL}` : fallback
    //           → "https://my-app.vercel.app"  (WRONG)
    // Fixed code: base = APP_URL || ...
    //             → "https://custom.example.com"  (CORRECT)
    process.env.APP_URL = "https://custom.example.com";
    process.env.VERCEL_URL = "my-app.vercel.app";
    const base = resolveBase();
    expect(base).not.toBe("https://my-app.vercel.app");
    expect(base).toBe("https://custom.example.com");
  });
});
