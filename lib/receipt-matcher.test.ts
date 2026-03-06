import { describe, it, expect } from "vitest";
import { normalizeMerchant, extractKeyword, scoreCandidates } from "./receipt-matcher";

describe("normalizeMerchant", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeMerchant("Amazon.com")).toBe("amazoncom");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeMerchant("Whole   Foods  Market")).toBe("whole foods market");
  });

  it("handles empty string", () => {
    expect(normalizeMerchant("")).toBe("");
  });
});

describe("extractKeyword", () => {
  it("extracts first word from merchant", () => {
    expect(extractKeyword("Amazon.com")).toBe("amazoncom");
  });

  it("extracts first word from multi-word merchant", () => {
    expect(extractKeyword("Whole Foods Market")).toBe("whole");
  });

  it("returns null for short keywords", () => {
    expect(extractKeyword("AB")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(extractKeyword("")).toBe(null);
  });
});

describe("scoreCandidates", () => {
  const candidates = [
    { id: "tx1", amount: -49.99, date: "2026-02-15" },
    { id: "tx2", amount: -50.50, date: "2026-02-16" },
    { id: "tx3", amount: -100.00, date: "2026-02-15" },
  ];

  it("matches exact amount and date", () => {
    const result = scoreCandidates(candidates, 49.99, "2026-02-15");
    expect(result).toBe("tx1");
  });

  it("matches within $1 tolerance", () => {
    const result = scoreCandidates(candidates, 50.00, "2026-02-15");
    // tx1 (diff $0.01) and tx2 (diff $0.50) both within tolerance, tx1 is closer by amount
    expect(result).toBe("tx1");
  });

  it("rejects candidates outside $1 tolerance", () => {
    const result = scoreCandidates(candidates, 52.00, "2026-02-15");
    // tx1 diff $2.01, tx2 diff $1.50, tx3 diff $48 — all outside tolerance
    expect(result).toBe(null);
  });

  it("prefers closer date when amounts are equal distance", () => {
    const tiedCandidates = [
      { id: "far", amount: -50.00, date: "2026-02-10" },
      { id: "close", amount: -50.00, date: "2026-02-15" },
    ];
    const result = scoreCandidates(tiedCandidates, 50.00, "2026-02-14");
    expect(result).toBe("close");
  });

  it("works without receipt date (dateDiff = 0 for all)", () => {
    const result = scoreCandidates(candidates, 49.99, null);
    expect(result).toBe("tx1");
  });

  it("returns null for empty candidates", () => {
    const result = scoreCandidates([], 50.00, "2026-02-15");
    expect(result).toBe(null);
  });

  it("handles positive transaction amounts", () => {
    const positiveCandidates = [
      { id: "tx1", amount: 25.00, date: "2026-02-15" },
    ];
    const result = scoreCandidates(positiveCandidates, 25.00, "2026-02-15");
    expect(result).toBe("tx1");
  });
});
