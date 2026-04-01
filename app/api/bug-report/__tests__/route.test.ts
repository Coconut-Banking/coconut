import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Clerk auth
vi.mock("@/lib/auth", () => ({
  loadClerkAuth: vi.fn(),
}));

import { loadClerkAuth } from "@/lib/auth";

const mockAuth = vi.mocked(loadClerkAuth);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/bug-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_BOT_TOKEN = "ghp_test_token";
  });

  it("exports POST handler", async () => {
    const mod = await import("../route");
    expect(mod.POST).toBeDefined();
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: null, getToken: vi.fn() });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ title: "Test bug", description: "Something broke badly here" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when Clerk is rate-limited", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "rate_limited" });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ title: "Test bug", description: "Something broke badly here" }));
    expect(res.status).toBe(503);
  });

  it("returns 400 when title is missing", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: "user_123", getToken: vi.fn() });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ description: "Something broke badly here" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/title/);
  });

  it("returns 400 when description is too short", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: "user_123", getToken: vi.fn() });
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ title: "Bug title", description: "short" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/description/);
  });

  it("returns 503 when GITHUB_BOT_TOKEN is not set", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: "user_123", getToken: vi.fn() });
    delete process.env.GITHUB_BOT_TOKEN;
    // Re-import to pick up env change
    vi.resetModules();
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ title: "Test bug", description: "Something broke badly here" }));
    expect(res.status).toBe(503);
  });

  it("calls GitHub API and returns 201 on success", async () => {
    mockAuth.mockResolvedValue({ ok: true, userId: "user_abc123", getToken: vi.fn() });
    process.env.GITHUB_BOT_TOKEN = "ghp_test_token";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ number: 42, html_url: "https://github.com/Coconut-Banking/coconut-app/issues/42" }),
    }));

    vi.resetModules();
    // Re-mock after resetModules
    vi.mock("@/lib/auth", () => ({
      loadClerkAuth: vi.fn().mockResolvedValue({ ok: true, userId: "user_abc123", getToken: vi.fn() }),
    }));

    const { POST } = await import("../route");
    const res = await POST(makeRequest({
      title: "Crash on split screen",
      description: "App crashes when I open the split screen with more than 3 people",
      appVersion: "1.2.3",
      deviceModel: "iPhone 15 Pro",
      osVersion: "iOS 17.4",
      currentRoute: "/app/friends",
      severity: "high",
    }));

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.issueNumber).toBe(42);
    expect(json.issueUrl).toContain("issues/42");
  });
});
