/**
 * Pure logic for computing expense share amounts.
 * Used by manual-expense API and tested in isolation.
 */

export function computeEqualShares(
  amount: number,
  memberIds: string[]
): { memberId: string; amount: number }[] {
  if (memberIds.length === 0) return [];
  const sharePerPerson = Math.floor((amount / memberIds.length) * 100) / 100;
  const remainder = Math.round((amount - sharePerPerson * memberIds.length) * 100) / 100;
  return memberIds.map((id, i) => ({
    memberId: id,
    amount: i === 0 ? sharePerPerson + remainder : sharePerPerson,
  }));
}

export function computeTwoWayShares(
  amount: number,
  memberIdA: string,
  memberIdB: string
): { memberId: string; amount: number }[] {
  const half = Math.round((amount / 2) * 100) / 100;
  return [
    { memberId: memberIdA, amount: half },
    { memberId: memberIdB, amount: amount - half },
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
