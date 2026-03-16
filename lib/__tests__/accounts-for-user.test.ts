import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountsFromTransactionIds } from "../accounts-for-user";

function createMockDb(accountsResult: Array<Record<string, unknown>> | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  const from = vi.fn().mockImplementation(() => {
    chain.eq.mockResolvedValueOnce({ data: accountsResult });
    return chain;
  });
  return {
    from,
    _chain: chain,
  } as unknown as SupabaseClient;
}

describe("getAccountsFromTransactionIds", () => {
  it("returns null when tx rows have no account_ids", async () => {
    const db = createMockDb([]);
    const result = await getAccountsFromTransactionIds(db, "user-1", [
      { account_id: null },
      { account_id: null },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when tx rows are empty", async () => {
    const db = createMockDb(null);
    const result = await getAccountsFromTransactionIds(db, "user-1", []);
    expect(result).toBeNull();
  });

  it("returns accounts when tx has account_ids and db returns matching rows", async () => {
    const mockAccounts = [
      {
        id: "uuid-1",
        plaid_account_id: "plaid-1",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        mask: "1234",
        balance_current: 100,
        balance_available: 90,
        iso_currency_code: "USD",
      },
    ];
    const db = createMockDb(mockAccounts);
    const result = await getAccountsFromTransactionIds(db, "user-1", [
      { account_id: "uuid-1" },
      { account_id: "uuid-1" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      account_id: "plaid-1",
      id: "uuid-1",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      mask: "1234",
      balance_current: 100,
      balance_available: 90,
      iso_currency_code: "USD",
    });
  });

  it("returns null when db returns no matching accounts", async () => {
    const db = createMockDb(null);
    const result = await getAccountsFromTransactionIds(db, "user-1", [
      { account_id: "uuid-999" },
    ]);
    expect(result).toBeNull();
  });
});
