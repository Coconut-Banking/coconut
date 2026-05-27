import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
}));

vi.mock("@/lib/stripe-pay-link", () => ({
  assertUserCanCreatePayLink: vi.fn(async () => ({ ok: true })),
  resolvePayLinkAmount: vi.fn(async (payload: { amount: number }) => ({
    ok: true,
    amount: payload.amount,
  })),
}));

vi.mock("@/lib/pay-link-token", () => ({
  createPayLinkToken: vi.fn(() => "signed-token-abc"),
  payLinkPublicUrl: vi.fn((token: string) => `https://coconut-app.dev/pay/${token}`),
}));

describe("POST /api/stripe/create-payment-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns signed url and token for valid body", async () => {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/stripe/create-payment-link", {
      method: "POST",
      body: JSON.stringify({
        amount: 14.25,
        currency: "USD",
        groupId: "grp_1",
        payerMemberId: "mem_payer",
        receiverMemberId: "mem_recv",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      url: "https://coconut-app.dev/pay/signed-token-abc",
      token: "signed-token-abc",
    });
  });

  it("rejects missing member ids", async () => {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/stripe/create-payment-link", {
      method: "POST",
      body: JSON.stringify({ amount: 10, groupId: "grp_1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });
});
