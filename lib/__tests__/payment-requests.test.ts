import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("../supabase", () => ({
  getSupabase: () => ({
    from: mockFrom,
  }),
}));

vi.mock("../pay-link-token", () => ({
  createPayLinkToken: () => "signed.token.here",
  payLinkPublicUrl: (t: string) => `https://example.com/pay/${t}`,
}));

import { payUrlForStoredToken } from "../payment-requests";

describe("payment-requests", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("payUrlForStoredToken returns public URL", () => {
    expect(payUrlForStoredToken("abc")).toBe("https://example.com/pay/abc");
    expect(payUrlForStoredToken(null)).toBeNull();
  });
});
