import { describe, it, expect } from "vitest";

/**
 * Tests the account deduplication logic used by /api/plaid/accounts.
 * We simulate the deduplicateAccounts behavior: group by (name|mask), prefer account with transactions.
 */
function simulateDedupe(
  accounts: { id: string; name: string; mask: string | null }[],
  idsWithTx: Set<string>
): { id: string; name: string; mask: string | null }[] {
  if (accounts.length <= 1) return accounts;
  const byKey = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const key = `${a.name ?? ""}|${a.mask ?? ""}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }
  const result: typeof accounts = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }
    const withTx = list.filter((a) => idsWithTx.has(a.id));
    result.push(withTx.length > 0 ? withTx[0] : list[0]);
  }
  return result;
}

describe("accounts deduplication", () => {
  it("returns single account unchanged", () => {
    const accounts = [{ id: "a1", name: "Checking", mask: "1234" }];
    expect(simulateDedupe(accounts, new Set())).toEqual(accounts);
  });

  it("dedupes duplicate name+mask, prefers one with transactions", () => {
    const accounts = [
      { id: "a1", name: "TOTAL CHECKING", mask: "2632" },
      { id: "a2", name: "TOTAL CHECKING", mask: "2632" },
    ];
    const idsWithTx = new Set(["a2"]);
    const result = simulateDedupe(accounts, idsWithTx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a2");
  });

  it("when neither has tx, keeps first", () => {
    const accounts = [
      { id: "a1", name: "TOTAL CHECKING", mask: "2632" },
      { id: "a2", name: "TOTAL CHECKING", mask: "2632" },
    ];
    const result = simulateDedupe(accounts, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
  });

  it("keeps distinct accounts (different name or mask)", () => {
    const accounts = [
      { id: "a1", name: "Checking", mask: "1234" },
      { id: "a2", name: "Savings", mask: "5678" },
    ];
    const result = simulateDedupe(accounts, new Set());
    expect(result).toHaveLength(2);
  });

  it("handles null mask", () => {
    const accounts = [
      { id: "a1", name: "Account", mask: null },
      { id: "a2", name: "Account", mask: null },
    ];
    const idsWithTx = new Set(["a2"]);
    const result = simulateDedupe(accounts, idsWithTx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a2");
  });
});
