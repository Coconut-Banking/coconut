import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("../supabase", () => ({
  getSupabase: () => ({
    rpc: rpcMock,
  }),
}));

import { recordStripeSettlement } from "../stripe-settlement-record";

describe("recordStripeSettlement", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const baseParams = {
    groupId: "g1",
    payerMemberId: "p1",
    receiverMemberId: "r1",
    amount: 50,
    currency: "USD",
    externalReference: "pi_123",
    source: "terminal" as const,
  };

  it("calls insert_stripe_settlement_checked RPC", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "s1", amount: 50 },
      error: null,
    });

    const result = await recordStripeSettlement(baseParams);

    expect(result).toEqual({ ok: true, amountRecorded: 50 });
    expect(rpcMock).toHaveBeenCalledWith("insert_stripe_settlement_checked", {
      p_group_id: "g1",
      p_payer_member_id: "p1",
      p_receiver_member_id: "r1",
      p_amount: 50,
      p_currency: "USD",
      p_external_reference: "pi_123",
    });
  });

  it("returns amountRecorded 0 when already_exists", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "s1", amount: 50, already_exists: true },
      error: null,
    });

    const result = await recordStripeSettlement(baseParams);

    expect(result).toEqual({ ok: true, amountRecorded: 0 });
  });

  it("returns error when RPC returns cap failure", async () => {
    rpcMock.mockResolvedValue({
      data: { error: "Already settled between these members in this currency", max_amount: 0 },
      error: null,
    });

    const result = await recordStripeSettlement(baseParams);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Already settled");
    }
  });

  it("returns error when RPC transport fails", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "connection failed" },
    });

    const result = await recordStripeSettlement(baseParams);

    expect(result).toEqual({ ok: false, status: 500, error: "DB insert failed" });
  });
});
