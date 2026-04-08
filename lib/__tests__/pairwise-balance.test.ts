/**
 * Tests for pairwise balance computation between two specific people.
 *
 * This is the logic used in /api/groups/person to compute how much
 * one user owes another ACROSS multiple shared groups. The critical
 * invariant: in a 3+ person group, the pairwise balance between
 * two people must only reflect transactions where one of them paid,
 * NOT the other person's total group-level balance.
 *
 * The old (broken) approach: take -theirGroupBalance
 *   → In a 3-person group where a third person paid, this wrongly
 *     attributed the friend's group debt (to third party) to you.
 *
 * The correct approach: per-transaction pairwise computation.
 *   If I paid → they owe me their share.
 *   If they paid → I owe them my share.
 *   Third-party payer → no pairwise effect between us.
 */
import { describe, it, expect } from "vitest";

type Share = { splitId: string; memberId: string; amount: number };
type Split = { id: string; payerId: string; currency: string };

/**
 * Extracted pairwise balance logic matching the person endpoint.
 * Returns positive = they owe me, negative = I owe them.
 */
function computePairwiseBalance(
  myMemberId: string,
  theirMemberId: string,
  splits: Split[],
  shares: Share[],
  settlements: {
    payerMemberId: string;
    receiverMemberId: string;
    amount: number;
    currency: string;
  }[] = []
): Map<string, number> {
  const byCurrency = new Map<string, number>();

  const sharesByTx = new Map<string, Map<string, number>>();
  for (const sh of shares) {
    let txMap = sharesByTx.get(sh.splitId);
    if (!txMap) {
      txMap = new Map();
      sharesByTx.set(sh.splitId, txMap);
    }
    txMap.set(sh.memberId, (txMap.get(sh.memberId) ?? 0) + sh.amount);
  }

  for (const s of splits) {
    const cur = s.currency;
    const txShares = sharesByTx.get(s.id);
    if (!txShares) continue;

    if (s.payerId === myMemberId) {
      const theirShare = txShares.get(theirMemberId) ?? 0;
      if (theirShare > 0) {
        const prev = byCurrency.get(cur) ?? 0;
        byCurrency.set(cur, Math.round((prev + theirShare) * 100) / 100);
      }
    } else if (s.payerId === theirMemberId) {
      const myShare = txShares.get(myMemberId) ?? 0;
      if (myShare > 0) {
        const prev = byCurrency.get(cur) ?? 0;
        byCurrency.set(cur, Math.round((prev - myShare) * 100) / 100);
      }
    }
  }

  for (const st of settlements) {
    const cur = st.currency;
    if (st.payerMemberId === myMemberId && st.receiverMemberId === theirMemberId) {
      const prev = byCurrency.get(cur) ?? 0;
      byCurrency.set(cur, Math.round((prev + st.amount) * 100) / 100);
    } else if (st.payerMemberId === theirMemberId && st.receiverMemberId === myMemberId) {
      const prev = byCurrency.get(cur) ?? 0;
      byCurrency.set(cur, Math.round((prev - st.amount) * 100) / 100);
    }
  }

  return byCurrency;
}

describe("pairwise balance: 2-person group", () => {
  it("I paid $100, split equally → they owe me $50", () => {
    const result = computePairwiseBalance(
      "me",
      "them",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "them", amount: 50 },
      ]
    );
    expect(result.get("USD")).toBe(50);
  });

  it("they paid $100, split equally → I owe them $50", () => {
    const result = computePairwiseBalance(
      "me",
      "them",
      [{ id: "s1", payerId: "them", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "them", amount: 50 },
      ]
    );
    expect(result.get("USD")).toBe(-50);
  });

  it("I paid $10, split equally → they owe me $5", () => {
    const result = computePairwiseBalance(
      "me",
      "them",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 5 },
        { splitId: "s1", memberId: "them", amount: 5 },
      ]
    );
    expect(result.get("USD")).toBe(5);
  });

  it("multiple expenses accumulate", () => {
    const result = computePairwiseBalance(
      "me",
      "them",
      [
        { id: "s1", payerId: "me", currency: "USD" },
        { id: "s2", payerId: "them", currency: "USD" },
      ],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "them", amount: 50 },
        { splitId: "s2", memberId: "me", amount: 30 },
        { splitId: "s2", memberId: "them", amount: 30 },
      ]
    );
    // They owe me 50 from s1, I owe them 30 from s2 → net +20
    expect(result.get("USD")).toBe(20);
  });

  it("no expenses → no balance", () => {
    const result = computePairwiseBalance("me", "them", [], []);
    expect(result.size).toBe(0);
  });
});

describe("pairwise balance: 3-person group (THE BUG SCENARIO)", () => {
  it("third person paid → no pairwise effect between me and friend", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "third", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 33.33 },
        { splitId: "s1", memberId: "friend", amount: 33.33 },
        { splitId: "s1", memberId: "third", amount: 33.34 },
      ]
    );
    // Neither me nor friend paid → no pairwise debt between us
    expect(result.get("USD") ?? 0).toBe(0);
  });

  it("I paid in 3-person group → friend only owes their share, not third person's", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 100 },
        { splitId: "s1", memberId: "friend", amount: 100 },
        { splitId: "s1", memberId: "third", amount: 100 },
      ]
    );
    // Friend owes me ONLY their $100 share, NOT third person's $100
    expect(result.get("USD")).toBe(100);
  });

  it("friend paid in 3-person group → I only owe my share", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "friend", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 100 },
        { splitId: "s1", memberId: "friend", amount: 100 },
        { splitId: "s1", memberId: "third", amount: 100 },
      ]
    );
    // I owe friend ONLY my $100 share, NOT third person's $100
    expect(result.get("USD")).toBe(-100);
  });

  it("mix of payers in 3-person group", () => {
    // Expense 1: I paid $90 split 3 ways ($30 each)
    // Expense 2: Third person paid $60 split 3 ways ($20 each)
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "s1", payerId: "me", currency: "USD" },
        { id: "s2", payerId: "third", currency: "USD" },
      ],
      [
        { splitId: "s1", memberId: "me", amount: 30 },
        { splitId: "s1", memberId: "friend", amount: 30 },
        { splitId: "s1", memberId: "third", amount: 30 },
        { splitId: "s2", memberId: "me", amount: 20 },
        { splitId: "s2", memberId: "friend", amount: 20 },
        { splitId: "s2", memberId: "third", amount: 20 },
      ]
    );
    // From s1: friend owes me $30 (I paid, their share is $30)
    // From s2: third paid → no pairwise effect
    // Net: +$30
    expect(result.get("USD")).toBe(30);
  });

  it("5-person group: only pairwise transactions matter", () => {
    // Alice paid $500 split 5 ways ($100 each)
    // Bob paid $250 split 5 ways ($50 each)
    // Charlie paid $150 split 5 ways ($30 each)
    // Pairwise between me and friend:
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "s1", payerId: "alice", currency: "USD" },
        { id: "s2", payerId: "bob", currency: "USD" },
        { id: "s3", payerId: "charlie", currency: "USD" },
      ],
      [
        // s1: Alice pays $500 → 5 people × $100
        { splitId: "s1", memberId: "me", amount: 100 },
        { splitId: "s1", memberId: "friend", amount: 100 },
        { splitId: "s1", memberId: "alice", amount: 100 },
        { splitId: "s1", memberId: "bob", amount: 100 },
        { splitId: "s1", memberId: "charlie", amount: 100 },
        // s2: Bob pays $250 → 5 people × $50
        { splitId: "s2", memberId: "me", amount: 50 },
        { splitId: "s2", memberId: "friend", amount: 50 },
        { splitId: "s2", memberId: "alice", amount: 50 },
        { splitId: "s2", memberId: "bob", amount: 50 },
        { splitId: "s2", memberId: "charlie", amount: 50 },
        // s3: Charlie pays $150 → 5 people × $30
        { splitId: "s3", memberId: "me", amount: 30 },
        { splitId: "s3", memberId: "friend", amount: 30 },
        { splitId: "s3", memberId: "alice", amount: 30 },
        { splitId: "s3", memberId: "bob", amount: 30 },
        { splitId: "s3", memberId: "charlie", amount: 30 },
      ]
    );
    // Neither me nor friend paid for any of these → zero pairwise
    expect(result.get("USD") ?? 0).toBe(0);
  });

  it("5-person group: I paid one expense, friend paid another", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "s1", payerId: "me", currency: "USD" },
        { id: "s2", payerId: "friend", currency: "USD" },
      ],
      [
        // s1: I pay $500 → 5 people × $100
        { splitId: "s1", memberId: "me", amount: 100 },
        { splitId: "s1", memberId: "friend", amount: 100 },
        { splitId: "s1", memberId: "alice", amount: 100 },
        { splitId: "s1", memberId: "bob", amount: 100 },
        { splitId: "s1", memberId: "charlie", amount: 100 },
        // s2: Friend pays $250 → 5 people × $50
        { splitId: "s2", memberId: "me", amount: 50 },
        { splitId: "s2", memberId: "friend", amount: 50 },
        { splitId: "s2", memberId: "alice", amount: 50 },
        { splitId: "s2", memberId: "bob", amount: 50 },
        { splitId: "s2", memberId: "charlie", amount: 50 },
      ]
    );
    // From s1: friend owes me $100
    // From s2: I owe friend $50
    // Net: +$50
    expect(result.get("USD")).toBe(50);
  });
});

describe("pairwise balance: across multiple groups", () => {
  it("balances from 2-person group and 3-person group combine correctly", () => {
    // Group A (2 people): I paid $20, split equally
    // Group B (3 people): Third person paid $90, split equally
    const group1 = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "g1s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "g1s1", memberId: "me", amount: 10 },
        { splitId: "g1s1", memberId: "friend", amount: 10 },
      ]
    );

    const group2 = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "g2s1", payerId: "third", currency: "USD" }],
      [
        { splitId: "g2s1", memberId: "me", amount: 30 },
        { splitId: "g2s1", memberId: "friend", amount: 30 },
        { splitId: "g2s1", memberId: "third", amount: 30 },
      ]
    );

    const combined = (group1.get("USD") ?? 0) + (group2.get("USD") ?? 0);
    // Group A: friend owes me $10
    // Group B: third paid → 0 pairwise
    // Total: $10
    expect(combined).toBe(10);
  });

  it("THE EXACT BUG: large trip group + small 1:1 group", () => {
    // Scenario: User has a trip group with 5 people and $5000 of expenses
    // (all paid by other people). Plus a 1:1 group with a $20 dinner.
    // OLD BUG: would show ~$1000+ because friend's total group debt was attributed to user.

    // Trip group: Alice paid $2000, Bob paid $3000, split 5 ways
    const tripGroup = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "trip1", payerId: "alice", currency: "USD" },
        { id: "trip2", payerId: "bob", currency: "USD" },
      ],
      [
        { splitId: "trip1", memberId: "me", amount: 400 },
        { splitId: "trip1", memberId: "friend", amount: 400 },
        { splitId: "trip1", memberId: "alice", amount: 400 },
        { splitId: "trip1", memberId: "bob", amount: 400 },
        { splitId: "trip1", memberId: "charlie", amount: 400 },
        { splitId: "trip2", memberId: "me", amount: 600 },
        { splitId: "trip2", memberId: "friend", amount: 600 },
        { splitId: "trip2", memberId: "alice", amount: 600 },
        { splitId: "trip2", memberId: "bob", amount: 600 },
        { splitId: "trip2", memberId: "charlie", amount: 600 },
      ]
    );

    // 1:1 group: I paid $20 dinner, split equally
    const dinnerGroup = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "dinner1", payerId: "me", currency: "USD" }],
      [
        { splitId: "dinner1", memberId: "me", amount: 10 },
        { splitId: "dinner1", memberId: "friend", amount: 10 },
      ]
    );

    const tripBalance = tripGroup.get("USD") ?? 0;
    const dinnerBalance = dinnerGroup.get("USD") ?? 0;

    // Trip: neither me nor friend paid → $0 pairwise
    expect(tripBalance).toBe(0);
    // Dinner: friend owes me $10
    expect(dinnerBalance).toBe(10);
    // Total should be $10, NOT thousands
    expect(tripBalance + dinnerBalance).toBe(10);
  });
});

describe("pairwise balance: settlements", () => {
  it("settlement between me and friend adjusts balance", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "friend", amount: 50 },
      ],
      [{ payerMemberId: "friend", receiverMemberId: "me", amount: 50, currency: "USD" }]
    );
    // Friend owed me $50, then paid me $50 → settled
    expect(result.get("USD")).toBe(0);
  });

  it("partial settlement", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "friend", amount: 50 },
      ],
      [{ payerMemberId: "friend", receiverMemberId: "me", amount: 20, currency: "USD" }]
    );
    // Friend owed me $50, paid $20 → still owes $30
    expect(result.get("USD")).toBe(30);
  });

  it("settlement between unrelated parties has no effect", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "friend", amount: 50 },
      ],
      [{ payerMemberId: "third", receiverMemberId: "alice", amount: 100, currency: "USD" }]
    );
    // Unrelated settlement → no effect
    expect(result.get("USD")).toBe(50);
  });

  it("I pay them (settlement) reduces what I owe", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "friend", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 50 },
        { splitId: "s1", memberId: "friend", amount: 50 },
      ],
      [{ payerMemberId: "me", receiverMemberId: "friend", amount: 50, currency: "USD" }]
    );
    // I owed friend $50, then paid them $50 → settled
    expect(result.get("USD")).toBe(0);
  });
});

describe("pairwise balance: multi-currency", () => {
  it("keeps currencies separate", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "s1", payerId: "me", currency: "USD" },
        { id: "s2", payerId: "me", currency: "CAD" },
      ],
      [
        { splitId: "s1", memberId: "me", amount: 25 },
        { splitId: "s1", memberId: "friend", amount: 25 },
        { splitId: "s2", memberId: "me", amount: 50 },
        { splitId: "s2", memberId: "friend", amount: 50 },
      ]
    );
    expect(result.get("USD")).toBe(25);
    expect(result.get("CAD")).toBe(50);
  });

  it("settlement in one currency doesn't affect another", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "s1", payerId: "me", currency: "USD" },
        { id: "s2", payerId: "me", currency: "CAD" },
      ],
      [
        { splitId: "s1", memberId: "me", amount: 25 },
        { splitId: "s1", memberId: "friend", amount: 25 },
        { splitId: "s2", memberId: "me", amount: 50 },
        { splitId: "s2", memberId: "friend", amount: 50 },
      ],
      [{ payerMemberId: "friend", receiverMemberId: "me", amount: 25, currency: "USD" }]
    );
    expect(result.get("USD")).toBe(0);
    expect(result.get("CAD")).toBe(50);
  });
});

describe("pairwise balance: edge cases", () => {
  it("0-cent expense has no effect", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 0 },
        { splitId: "s1", memberId: "friend", amount: 0 },
      ]
    );
    expect(result.get("USD") ?? 0).toBe(0);
  });

  it("expense with no shares for friend", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [{ splitId: "s1", memberId: "me", amount: 100 }]
    );
    expect(result.get("USD") ?? 0).toBe(0);
  });

  it("floating point: $33.33 split 3 ways", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 11.11 },
        { splitId: "s1", memberId: "friend", amount: 11.11 },
        { splitId: "s1", memberId: "third", amount: 11.11 },
      ]
    );
    expect(result.get("USD")).toBe(11.11);
  });

  it("many small expenses accumulate without floating point drift", () => {
    const splits: Split[] = [];
    const shares: Share[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `s${i}`;
      splits.push({ id, payerId: "me", currency: "USD" });
      shares.push({ splitId: id, memberId: "me", amount: 0.5 });
      shares.push({ splitId: id, memberId: "friend", amount: 0.5 });
    }
    const result = computePairwiseBalance("me", "friend", splits, shares);
    expect(result.get("USD")).toBe(50);
  });

  it("alternating payers cancel out", () => {
    const splits: Split[] = [];
    const shares: Share[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `s${i}`;
      const payer = i % 2 === 0 ? "me" : "friend";
      splits.push({ id, payerId: payer, currency: "USD" });
      shares.push({ splitId: id, memberId: "me", amount: 10 });
      shares.push({ splitId: id, memberId: "friend", amount: 10 });
    }
    const result = computePairwiseBalance("me", "friend", splits, shares);
    // 10 expenses I paid (friend owes 10 each = +100)
    // 10 expenses friend paid (I owe 10 each = -100)
    // Net: 0
    expect(result.get("USD")).toBe(0);
  });

  it("uneven custom splits", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 20 },
        { splitId: "s1", memberId: "friend", amount: 80 },
      ]
    );
    expect(result.get("USD")).toBe(80);
  });

  it("friend has zero share when I paid", () => {
    const result = computePairwiseBalance(
      "me",
      "friend",
      [{ id: "s1", payerId: "me", currency: "USD" }],
      [
        { splitId: "s1", memberId: "me", amount: 100 },
        { splitId: "s1", memberId: "friend", amount: 0 },
        { splitId: "s1", memberId: "third", amount: 100 },
      ]
    );
    expect(result.get("USD") ?? 0).toBe(0);
  });
});

describe("pairwise vs group-level: regression for the thousands-of-dollars bug", () => {
  it("trip group with $10,000 in expenses from other people: pairwise is $0", () => {
    const splits: Split[] = [];
    const shares: Share[] = [];
    const others = ["alice", "bob", "charlie", "dave"];
    for (let i = 0; i < 20; i++) {
      const id = `trip${i}`;
      const payer = others[i % others.length];
      splits.push({ id, payerId: payer, currency: "USD" });
      // $500 each, split 6 ways
      for (const m of ["me", "friend", ...others]) {
        shares.push({ splitId: id, memberId: m, amount: 83.33 });
      }
    }
    const result = computePairwiseBalance("me", "friend", splits, shares);
    // Neither me nor friend paid for anything → $0 pairwise
    expect(result.get("USD") ?? 0).toBe(0);
  });

  it("household group with mixed payers: only our transactions count", () => {
    // 4-person household: me, friend, roommate1, roommate2
    // Roommate1 pays rent $2000 split 4 ways ($500 each) — not our pairwise debt
    // Roommate2 pays utilities $400 split 4 ways ($100 each) — not our pairwise debt
    // I pay groceries $200 split 4 ways ($50 each) — friend owes me $50
    // Friend pays internet $80 split 4 ways ($20 each) — I owe friend $20
    const result = computePairwiseBalance(
      "me",
      "friend",
      [
        { id: "rent", payerId: "roommate1", currency: "USD" },
        { id: "util", payerId: "roommate2", currency: "USD" },
        { id: "groc", payerId: "me", currency: "USD" },
        { id: "net", payerId: "friend", currency: "USD" },
      ],
      [
        // Rent
        { splitId: "rent", memberId: "me", amount: 500 },
        { splitId: "rent", memberId: "friend", amount: 500 },
        { splitId: "rent", memberId: "roommate1", amount: 500 },
        { splitId: "rent", memberId: "roommate2", amount: 500 },
        // Utilities
        { splitId: "util", memberId: "me", amount: 100 },
        { splitId: "util", memberId: "friend", amount: 100 },
        { splitId: "util", memberId: "roommate1", amount: 100 },
        { splitId: "util", memberId: "roommate2", amount: 100 },
        // Groceries
        { splitId: "groc", memberId: "me", amount: 50 },
        { splitId: "groc", memberId: "friend", amount: 50 },
        { splitId: "groc", memberId: "roommate1", amount: 50 },
        { splitId: "groc", memberId: "roommate2", amount: 50 },
        // Internet
        { splitId: "net", memberId: "me", amount: 20 },
        { splitId: "net", memberId: "friend", amount: 20 },
        { splitId: "net", memberId: "roommate1", amount: 20 },
        { splitId: "net", memberId: "roommate2", amount: 20 },
      ]
    );
    // Only groceries (+$50) and internet (-$20) affect our pairwise balance
    // NOT rent ($500) or utilities ($100)
    expect(result.get("USD")).toBe(30);
  });
});
