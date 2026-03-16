/**
 * Pure logic for computing expense share amounts.
 * Used by manual-expense API and tested in isolation.
 */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function computeEqualShares(
  amount: number,
  memberIds: string[]
): { memberId: string; amount: number }[] {
  if (memberIds.length === 0) return [];
  const totalCents = toCents(amount);
  const baseCents = Math.floor(totalCents / memberIds.length);
  const remainderCents = totalCents - baseCents * memberIds.length;
  return memberIds.map((id, i) => ({
    memberId: id,
    amount: (baseCents + (i < remainderCents ? 1 : 0)) / 100,
  }));
}

export function computeTwoWayShares(
  amount: number,
  memberIdA: string,
  memberIdB: string
): { memberId: string; amount: number }[] {
  const totalCents = toCents(amount);
  const halfCents = Math.floor(totalCents / 2);
  const remainderCents = totalCents - halfCents;
  return [
    { memberId: memberIdA, amount: halfCents / 100 },
    { memberId: memberIdB, amount: remainderCents / 100 },
  ];
}

export function validateCustomShares(
  amount: number,
  shares: Array<{ memberId: string; amount: number }>
): { valid: boolean; error?: string } {
  const sum = shares.reduce((s, sh) => s + Number(sh.amount), 0);
  if (Math.abs(sum - amount) > 0.01) {
    return { valid: false, error: `Shares must sum to $${amount.toFixed(2)}` };
  }
  const hasPositive = shares.some((s) => Number(s.amount) > 0);
  if (!hasPositive) {
    return { valid: false, error: "At least one share must be positive" };
  }
  return { valid: true };
}
