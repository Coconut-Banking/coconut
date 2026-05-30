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
  const remainder = totalCents % 2; // 0 or 1
  const [firstId, secondId] = memberIdA <= memberIdB
    ? [memberIdA, memberIdB]
    : [memberIdB, memberIdA];
  return [
    { memberId: firstId, amount: (halfCents + remainder) / 100 },
    { memberId: secondId, amount: halfCents / 100 },
  ];
}

export function validateCustomShares(
  amount: number,
  shares: Array<{ memberId: string; amount: number }>
): { valid: boolean; error?: string } {
  const sumCents = shares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
  if (Math.abs(sumCents - toCents(amount)) > 1) {
    return { valid: false, error: `Shares must sum to $${amount.toFixed(2)}` };
  }
  const hasPositive = shares.some((s) => Number(s.amount) > 0);
  if (!hasPositive) {
    return { valid: false, error: "At least one share must be positive" };
  }
  return { valid: true };
}

/** Sum of share amounts in cents (for invariant checks). */
export function sumShareAmountsCents(shares: Array<{ amount: number }>): number {
  return shares.reduce((s, sh) => s + toCents(Number(sh.amount)), 0);
}

/**
 * Split total by percentage weights. Remainder cents go to first assignees (stable).
 * Percent values need not be exactly 100 — weights are normalized.
 */
export function computePercentShares(
  amount: number,
  entries: Array<{ memberId: string; percent: number }>
): { memberId: string; amount: number }[] {
  if (entries.length === 0) return [];
  const totalCents = toCents(amount);
  const weightSum = entries.reduce((s, e) => s + Math.max(0, e.percent), 0);
  if (weightSum <= 0 || totalCents <= 0) {
    return entries.map((e) => ({ memberId: e.memberId, amount: 0 }));
  }

  const rawCents = entries.map((e) =>
    Math.floor((totalCents * Math.max(0, e.percent)) / weightSum),
  );
  let allocated = rawCents.reduce((s, c) => s + c, 0);
  const result = entries.map((e, i) => ({
    memberId: e.memberId,
    amount: rawCents[i] / 100,
  }));

  let idx = 0;
  while (allocated < totalCents && idx < entries.length) {
    result[idx].amount = Math.round((result[idx].amount + 0.01) * 100) / 100;
    allocated += 1;
    idx += 1;
  }
  return result;
}

/**
 * Split total by ratio weights (e.g. shares 2:1:1). Remainder cents to first assignees.
 */
export function computeSharesByRatio(
  amount: number,
  entries: Array<{ memberId: string; weight: number }>
): { memberId: string; amount: number }[] {
  if (entries.length === 0) return [];
  const totalCents = toCents(amount);
  const weightSum = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (weightSum <= 0 || totalCents <= 0) {
    return entries.map((e) => ({ memberId: e.memberId, amount: 0 }));
  }

  const rawCents = entries.map((e) =>
    Math.floor((totalCents * Math.max(0, e.weight)) / weightSum),
  );
  let allocated = rawCents.reduce((s, c) => s + c, 0);
  const result = entries.map((e, i) => ({
    memberId: e.memberId,
    amount: rawCents[i] / 100,
  }));

  let idx = 0;
  while (allocated < totalCents && idx < entries.length) {
    result[idx].amount = Math.round((result[idx].amount + 0.01) * 100) / 100;
    allocated += 1;
    idx += 1;
  }
  return result;
}

export type CrossGroupSettlementBucket = {
  groupId: string;
  payerMemberId: string;
  receiverMemberId: string;
  /** Maximum still owed in this group (cap). */
  amountOwed: number;
  currency: string;
};

export type CrossGroupSettlementPayment = CrossGroupSettlementBucket & {
  payAmount: number;
};

const MIN_SETTLEMENT_CENTS = 1;

/**
 * Allocate a partial/full payment across multiple group settlement buckets.
 * Never exceeds each bucket cap; last bucket absorbs cent remainder.
 */
export function allocateCrossGroupSettlementPayments(
  paymentAmount: number,
  buckets: CrossGroupSettlementBucket[],
): CrossGroupSettlementPayment[] {
  const active = buckets.filter((b) => toCents(b.amountOwed) >= MIN_SETTLEMENT_CENTS);
  if (active.length === 0 || paymentAmount <= 0) return [];

  const paymentCents = toCents(paymentAmount);

  if (active.length === 1) {
    const b = active[0];
    const payCents = Math.min(toCents(b.amountOwed), paymentCents);
    return [{ ...b, payAmount: payCents / 100 }];
  }

  const totalOwed = active.reduce((s, b) => s + b.amountOwed, 0);
  const payCentsByIndex: number[] = [];
  let allocatedCents = 0;

  for (let i = 0; i < active.length; i++) {
    const capCents = toCents(active[i].amountOwed);
    let payCents: number;
    if (i === active.length - 1) {
      payCents = Math.min(capCents, paymentCents - allocatedCents);
    } else {
      const proportion =
        totalOwed > 0 ? active[i].amountOwed / totalOwed : 1 / active.length;
      payCents = Math.min(capCents, Math.floor(paymentCents * proportion));
    }
    payCents = Math.max(0, payCents);
    payCentsByIndex.push(payCents);
    allocatedCents += payCents;
  }

  return active
    .map((b, i) => ({ ...b, payAmount: payCentsByIndex[i] / 100 }))
    .filter((row) => row.payAmount >= MIN_SETTLEMENT_CENTS / 100);
}
