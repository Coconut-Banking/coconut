import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const env = process.env;

function makeRequest(body: unknown, authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/revenuecat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/revenuecat", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    vi.mock("@/lib/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
      }),
    }));
  });

  afterEach(() => {
    process.env = env;
    vi.resetModules();
  });

  it("returns ok with subscriptions disabled when secret is unset", async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ event: { type: "INITIAL_PURCHASE" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, subscriptions: "disabled" });
  });

  it("returns 401 when Bearer token is wrong", async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = "expected-secret";
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest(
        { event: { type: "INITIAL_PURCHASE", app_user_id: "user_1" } },
        "Bearer wrong",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid Bearer when secret is configured", async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = "expected-secret";
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest(
        { event: { type: "INITIAL_PURCHASE", app_user_id: "user_1" } },
        "Bearer expected-secret",
      ),
    );
    expect(res.status).toBe(200);
  });
});
