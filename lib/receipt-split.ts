// Receipt Split — proportional tax/tip distribution & per-person share computation

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ReceiptItemWithExtras extends ReceiptItem {
  proportionalExtra: number;
  finalPrice: number;
}

/**
 * Distribute tax and tip proportionally across line items.
 *
 * Formula per item:
 *   proportion = item.totalPrice / subtotal
 *   extra = proportion * (tax + tip)
 *   finalPrice = totalPrice + extra
 *
 * The last item absorbs any rounding remainder so the sum of
 * all finalPrices === subtotal + tax + tip exactly.
 */
export function distributeExtras(
  items: ReceiptItem[],
  subtotal: number,
  tax: number,
  tip: number
): ReceiptItemWithExtras[] {
  const extraPool = tax + tip;

  if (subtotal === 0 || extraPool === 0) {
    return items.map((item) => ({
      ...item,
      proportionalExtra: 0,
      finalPrice: item.totalPrice,
    }));
  }

  let allocatedExtra = 0;

  return items.map((item, index) => {
    const proportion = item.totalPrice / subtotal;
    let extra: number;

    if (index === items.length - 1) {
      // Last item absorbs rounding remainder
      extra = Math.round((extraPool - allocatedExtra) * 100) / 100;
    } else {
      extra = Math.round(proportion * extraPool * 100) / 100;
      allocatedExtra += extra;
    }

    return {
      ...item,
      proportionalExtra: extra,
      finalPrice: Math.round((item.totalPrice + extra) * 100) / 100,
    };
  });
}

export interface Assignee {
  name: string;
  memberId: string | null;
}

export interface PersonShare {
  name: string;
  memberId: string | null;
  items: Array<{ itemName: string; shareAmount: number }>;
  totalOwed: number;
}

/**
 * Given items with final prices and a map of item-id → assignees,
 * compute how much each person owes in total.
 *
 * If an item is assigned to 3 people, each pays 1/3 of finalPrice.
 * Last assignee absorbs any rounding remainder.
 */
export function computePersonShares(
  items: ReceiptItemWithExtras[],
  assignments: Map<string, Assignee[]>
): PersonShare[] {
  const personMap = new Map<string, PersonShare>();

  for (const item of items) {
    const assignees = assignments.get(item.id);
    if (!assignees || assignees.length === 0) continue;

    const sharePerPerson =
      Math.round((item.finalPrice / assignees.length) * 100) / 100;
    let allocated = 0;

    assignees.forEach((assignee, idx) => {
      const key = assignee.name.toLowerCase();
      if (!personMap.has(key)) {
        personMap.set(key, {
          name: assignee.name,
          memberId: assignee.memberId,
          items: [],
          totalOwed: 0,
        });
      }
      const person = personMap.get(key)!;

      let amount: number;
      if (idx === assignees.length - 1) {
        amount = Math.round((item.finalPrice - allocated) * 100) / 100;
      } else {
        amount = sharePerPerson;
        allocated += amount;
      }

      person.items.push({ itemName: item.name, shareAmount: amount });
      person.totalOwed = Math.round((person.totalOwed + amount) * 100) / 100;
    });
  }

  return Array.from(personMap.values());
}
