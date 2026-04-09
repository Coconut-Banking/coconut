import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for POST /api/auth/handoff-token
 *
 * Regression test for BUG-ONBOARD-2:
 *   The handoff-token route ignored APP_URL when constructing the base URL,
 *   falling back straight to VERCEL_URL or the hardcoded "https://coconut-app.dev".
 *   The fix checks APP_URL first, matching the pattern used in
 *   app/api/plaid/create-link-token/route.ts.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

import { auth, clerkClient } from "@clerk/nextjs/server";

const mockAuth = vi.mocked(auth);
const mockClerkClient = vi.mocked(clerkClient);

/** Helper that builds a mock Clerk client whose signInTokens.createSignInToken
 *  resolves with the given token string. */
function makeClerkClient(token: string) {
  return {
    signInTokens: {
      createSignInToken: vi.fn().mockResolvedValue({ token }),
    },
  };
}

// ── Import the route (mocks already hoisted by vi.mock) ────────────────────

import { POST } from "../handoff-token/route";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Save and restore process.env around each test to avoid cross-test pollution. */
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  // Clear the env vars under test so each case controls them explicitly.
  delete process.env.APP_URL;
  delete process.env.VERCEL_URL;

  // Authenticated user by default.
  mockAuth.mockResolvedValue({ userId: "user_test_123" } as Awaited<
    ReturnType<typeof auth>
  >);
  mockClerkClient.mockResolvedValue(
    makeClerkClient("tok_abc") as unknown as Awaited<
      ReturnType<typeof clerkClient>
    >
  );
});

afterEach(() => {
  process.env = savedEnv;
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/handoff-token — BUG-ONBOARD-2", () => {
  it("uses APP_URL as the base when it is set (core regression)", async () => {
    /**
     * This test FAILS against the old code because the old code never reads
     * process.env.APP_URL. With both APP_URL and VERCEL_URL set, the old code
     * would use VERCEL_URL; the fix correctly prefers APP_URL.
     */
    process.env.APP_URL = "https://my-custom-domain.example.com";
    process.env.VERCEL_URL = "my-vercel-preview.vercel.app";

    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();

    // Both the handoff URL and the embedded redirect_url must use APP_URL.
    expect(json.url).toContain("https://my-custom-domain.example.com");
    expect(json.url).not.toContain("my-vercel-preview.vercel.app");
  });

  it("uses APP_URL even when VERCEL_URL is absent", async () => {
    process.env.APP_URL = "https://staging.myapp.io";
    // VERCEL_URL intentionally not set

    const res = await POST();
    const json = await res.json();

    expect(json.url).toContain("https://staging.myapp.io");
  });

  it("falls back to VERCEL_URL when APP_URL is not set", async () => {
    // APP_URL intentionally not set
    process.env.VERCEL_URL = "my-vercel-preview.vercel.app";

    const res = await POST();
    const json = await res.json();

    expect(json.url).toContain("https://my-vercel-preview.vercel.app");
  });

  it("falls back to hardcoded domain when neither APP_URL nor VERCEL_URL is set", async () => {
    // Both intentionally not set

    const res = await POST();
    const json = await res.json();

    expect(json.url).toContain("https://coconut-app.dev");
  });

  it("embeds the Clerk ticket token in the returned URL", async () => {
    process.env.APP_URL = "https://my-custom-domain.example.com";
    const clerk = makeClerkClient("tok_unique_xyz");
    mockClerkClient.mockResolvedValue(
      clerk as unknown as Awaited<ReturnType<typeof clerkClient>>
    );

    const res = await POST();
    const json = await res.json();

    expect(json.url).toContain("__clerk_ticket=tok_unique_xyz");
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null } as unknown as Awaited<
      ReturnType<typeof auth>
    >);

    const res = await POST();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 500 when Clerk throws during token creation", async () => {
    process.env.APP_URL = "https://my-custom-domain.example.com";
    const brokenClerk = {
      signInTokens: {
        createSignInToken: vi
          .fn()
          .mockRejectedValue(new Error("Clerk service error")),
      },
    };
    mockClerkClient.mockResolvedValue(
      brokenClerk as unknown as Awaited<ReturnType<typeof clerkClient>>
    );

    const res = await POST();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Failed to create handoff token");
  });
});
