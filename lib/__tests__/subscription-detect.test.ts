import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../subscription-config", () => ({ shouldExcludeAsSubscription: vi.fn(() => false) }));
vi.mock("../known-subscriptions", () => ({ matchKnownSubscription: vi.fn(() => null) }));

import { getSupabase } from "../supabase";
import { saveDetectedSubscriptions, type DetectedSubscription } from "../subscription-detect";

const mockGetSupabase = vi.mocked(getSupabase);

const DETECTED: DetectedSubscription = {
  merchantName: "Netflix",
  normalizedMerchant: "netflix",
  amount: 15.99,
  frequency: "monthly",
  lastChargeDate: "2026-04-01",
  nextDueDate: "2026-05-01",
  primaryCategory: "Entertainment",
  transactionCount: 3,
  transactionIds: [],
  transactionDetails: [],
  source: "known",
  confidence: 0.95,
};

function makeQueryBuilder(overrides: Record<string, unknown> = {}) {
  const builder: Record<string, unknown> = {
    select: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    then: undefined,
    ...overrides,
  };
  // Make each method return the builder itself for chaining by default
  (builder.select as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  (builder.update as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  (builder.upsert as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  (builder.eq as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  (builder.neq as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  (builder.in as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  return builder;
}

describe("saveDetectedSubscriptions – Promise.all error propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when .update() returns { error } (existing subscription path)", async () => {
    const dbError = new Error("DB update error");

    // We need two different "from" calls:
    // 1st: SELECT existing subscriptions → returns existing row so code takes toUpdate path
    // 2nd: the actual UPDATE call → returns { error }

    let callCount = 0;
    const selectBuilder = makeQueryBuilder();
    // The select chain terminates with a promise-like that resolves to { data: [existing] }
    (selectBuilder.in as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "sub-existing-1", status: "active", amount: 15.99, normalized_merchant: "netflix" }],
    });

    const updateBuilder = makeQueryBuilder();
    // The update chain terminates (after .neq()) with a promise-like that resolves to { error }
    (updateBuilder.neq as ReturnType<typeof vi.fn>).mockResolvedValue({ error: dbError });

    mockGetSupabase.mockReturnValue({
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) return selectBuilder as unknown as ReturnType<ReturnType<typeof getSupabase>["from"]>;
        return updateBuilder as unknown as ReturnType<ReturnType<typeof getSupabase>["from"]>;
      }),
    } as unknown as ReturnType<typeof getSupabase>);

    await expect(saveDetectedSubscriptions("user-1", [DETECTED])).rejects.toThrow("DB update error");
  });

  it("throws when .upsert() returns { error } (new subscription path)", async () => {
    const dbError = new Error("DB upsert error");

    let callCount = 0;
    const selectBuilder = makeQueryBuilder();
    // SELECT returns empty → code takes toUpsert path
    (selectBuilder.in as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

    const upsertBuilder = makeQueryBuilder();
    // upsert resolves to { error }
    (upsertBuilder.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ error: dbError });

    mockGetSupabase.mockReturnValue({
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) return selectBuilder as unknown as ReturnType<ReturnType<typeof getSupabase>["from"]>;
        return upsertBuilder as unknown as ReturnType<ReturnType<typeof getSupabase>["from"]>;
      }),
    } as unknown as ReturnType<typeof getSupabase>);

    await expect(saveDetectedSubscriptions("user-1", [DETECTED])).rejects.toThrow("DB upsert error");
  });
});
