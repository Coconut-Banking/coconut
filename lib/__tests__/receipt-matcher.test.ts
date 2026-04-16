/**
 * Unit tests for lib/receipt-matcher.ts
 *
 * Covers normalizeMerchant, merchantsMatch, extractKeywords, scoreCandidates,
 * and realistic receipt→transaction match scenarios.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeMerchant,
  merchantsMatch,
  extractKeywords,
  scoreCandidates,
} from "../receipt-matcher";

// ─── normalizeMerchant ────────────────────────────────────────────────────────

describe("normalizeMerchant", () => {
  describe("POS prefix stripping", () => {
    it("strips SQ * (Square)", () => {
      expect(normalizeMerchant("SQ *MENSHO")).toBe("mensho");
      expect(normalizeMerchant("SQ *Blue Bottle Coffee")).toBe("blue bottle coffee");
    });
    it("strips SQ* without space", () => {
      expect(normalizeMerchant("SQ*TARTINE")).toBe("tartine");
    });
    it("strips TST* (Toast)", () => {
      expect(normalizeMerchant("TST*TACOLICIOUS")).toBe("tacolicious");
    });
    it("strips TST (space) prefix", () => {
      expect(normalizeMerchant("TST DUMPLING TIME")).toBe("dumpling time");
    });
    it("strips SP * (Shopify)", () => {
      expect(normalizeMerchant("SP *Allbirds")).toBe("allbirds");
    });
    it("strips PP * (PayPal)", () => {
      expect(normalizeMerchant("PP *STUBHUB")).toBe("stubhub");
    });
    it("strips AMZN* prefix", () => {
      expect(normalizeMerchant("AMZN*MKTP US")).toBe("mktp us");
    });
    it("strips PayPal (space) prefix", () => {
      expect(normalizeMerchant("PayPal EBAY")).toBe("ebay");
    });
    it("strips Google* prefix", () => {
      expect(normalizeMerchant("Google *YouTube Premium")).toBe("youtube premium");
    });
    it("strips CHECKCARD prefix", () => {
      expect(normalizeMerchant("CHECKCARD 0412 COSTCO WHSE")).toBe("0412 costco whse");
    });
    it("strips POS prefix", () => {
      expect(normalizeMerchant("POS WALMART SUPERCENTER")).toBe("walmart supercenter");
    });
    it("is case-insensitive for prefix matching", () => {
      expect(normalizeMerchant("sq *Blue Bottle")).toBe("blue bottle");
    });
  });

  describe("character normalization", () => {
    it("lowercases result", () => {
      expect(normalizeMerchant("STARBUCKS")).toBe("starbucks");
    });
    it("strips apostrophes", () => {
      expect(normalizeMerchant("McDonald's")).toBe("mcdonalds");
      expect(normalizeMerchant("Trader Joe's")).toBe("trader joes");
      expect(normalizeMerchant("Lowe's")).toBe("lowes");
    });
    it("collapses multiple spaces", () => {
      expect(normalizeMerchant("HOME   DEPOT")).toBe("home depot");
    });
    it("trims whitespace", () => {
      expect(normalizeMerchant("  Nike  ")).toBe("nike");
    });
  });

  describe("numeric merchants", () => {
    it("preserves numbers", () => {
      expect(normalizeMerchant("7-Eleven")).toBe("7eleven");
      expect(normalizeMerchant("76 Gas")).toBe("76 gas");
    });
    it("preserves numbers after POS stripping", () => {
      expect(normalizeMerchant("SQ *7-Eleven")).toBe("7eleven");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(normalizeMerchant("")).toBe("");
    });
    it("handles all-punctuation string", () => {
      expect(normalizeMerchant("***---***")).toBe("");
    });
  });
});

// ─── merchantsMatch ───────────────────────────────────────────────────────────

describe("merchantsMatch", () => {
  describe("substring containment", () => {
    it("matches when one normalized form contains the other", () => {
      expect(merchantsMatch("Starbucks", "STARBUCKS COFFEE 1234")).toBe(true);
    });
    it("returns false for unrelated merchants", () => {
      expect(merchantsMatch("Shell", "Sheraton Hotel")).toBe(false);
    });
    it("returns false when either input is empty", () => {
      expect(merchantsMatch("", "Starbucks")).toBe(false);
      expect(merchantsMatch("Starbucks", "")).toBe(false);
    });
  });

  describe("keyword matching", () => {
    it("matches on shared keyword >= 3 chars", () => {
      expect(merchantsMatch("Chipotle Mexican Grill", "CHIPOTLE 2341")).toBe(true);
      expect(merchantsMatch("Best Buy", "BEST BUY #432")).toBe(true);
    });
  });

  describe("POS prefix stripping", () => {
    it("matches SQ * prefixed tx name against plain receipt merchant", () => {
      expect(merchantsMatch("Mensho Tokyo SF", "SQ *MENSHO")).toBe(true);
    });
    it("matches TST* prefixed tx name against plain receipt merchant", () => {
      expect(merchantsMatch("Tacolicious", "TST*TACOLICIOUS")).toBe(true);
    });
    it("matches AMZN* tx against Amazon receipt", () => {
      expect(merchantsMatch("Amazon", "AMZN*MKTP US")).toBe(true);
    });
  });

  describe("alias-based matching", () => {
    it("matches Uber variants", () => {
      expect(merchantsMatch("Uber", "UBER TRIP")).toBe(true);
      expect(merchantsMatch("Uber Eats", "UBER EATS")).toBe(true);
    });
    it("matches Amazon variants", () => {
      expect(merchantsMatch("Amazon", "AMZN MKTP")).toBe(true);
    });
    it("matches Trader Joe's variants", () => {
      expect(merchantsMatch("Trader Joe's", "TRADER JOE")).toBe(true);
    });
    it("matches Whole Foods variants", () => {
      expect(merchantsMatch("Whole Foods Market", "WHOLEFDS SFO")).toBe(true);
      expect(merchantsMatch("WFM", "Whole Foods")).toBe(true);
    });
    it("matches Walmart variants", () => {
      expect(merchantsMatch("Walmart", "WAL-MART")).toBe(true);
      expect(merchantsMatch("Walmart.com", "WM SUPERCENTER #1234")).toBe(true);
    });
    it("matches Home Depot variants", () => {
      expect(merchantsMatch("Home Depot", "THE HOME DEPOT #0604")).toBe(true);
    });
    it("matches Delta Airlines variants", () => {
      expect(merchantsMatch("Delta Airlines", "DELTA AIR")).toBe(true);
    });
    it("matches DoorDash variants", () => {
      expect(merchantsMatch("DoorDash", "DD DOORDASH")).toBe(true);
    });
    it("matches Grubhub / Seamless as same group", () => {
      expect(merchantsMatch("Grubhub", "SEAMLESS")).toBe(true);
      expect(merchantsMatch("Seamless", "Grubhub")).toBe(true);
    });
    it("matches OpenAI / ChatGPT", () => {
      expect(merchantsMatch("OpenAI", "OPENAI CHATGPT")).toBe(true);
    });
    it("does NOT match different alias groups", () => {
      expect(merchantsMatch("Airbnb", "Clipper")).toBe(false);
      expect(merchantsMatch("Netflix", "Spotify")).toBe(false);
      expect(merchantsMatch("Lyft", "Uber")).toBe(false);
      expect(merchantsMatch("Delta", "United Airlines")).toBe(false);
    });
  });

  describe("short merchant names", () => {
    it("matches CVS via substring", () => {
      expect(merchantsMatch("CVS", "CVS PHARMACY #4532")).toBe(true);
    });
    it("matches HEB via substring", () => {
      expect(merchantsMatch("HEB", "HEB GAS #0012")).toBe(true);
    });
  });

  describe("numeric merchants", () => {
    it("matches 7-Eleven variants", () => {
      expect(merchantsMatch("7-Eleven", "7-ELEVEN 34567")).toBe(true);
    });
  });
});

// ─── extractKeywords ──────────────────────────────────────────────────────────

describe("extractKeywords", () => {
  it("filters stop words", () => {
    const kws = extractKeywords("The Store Online");
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("store");
    expect(kws).not.toContain("online");
  });

  it("filters tokens shorter than MIN_KEYWORD_LENGTH", () => {
    const kws = extractKeywords("BP Gas");
    expect(kws).not.toContain("bp");
    expect(kws).toContain("gas");
  });

  it("deduplicates keywords", () => {
    const kws = extractKeywords("Amazon Amazon");
    expect(kws.filter((k) => k === "amazon").length).toBe(1);
  });

  it("injects alias canonical keys", () => {
    expect(extractKeywords("Amazon")).toContain("amazon");
    expect(extractKeywords("Uber Eats")).toContain("uber");
  });

  it("injects all alias tokens, not just first word", () => {
    // "trader joe" alias → both "trader" and "joe" should be available
    const kws = extractKeywords("Trader Joe's");
    expect(kws).toContain("trader");
    expect(kws).toContain("joe");
  });

  it("caps result at MAX_KEYWORDS (7)", () => {
    const kws = extractKeywords("Starbucks Coffee Roasters International Premium Blend Reserve");
    expect(kws.length).toBeLessThanOrEqual(7);
  });

  it("handles POS-prefixed merchant name", () => {
    const kws = extractKeywords("SQ *Blue Bottle Coffee");
    expect(kws).toContain("blue");
    expect(kws).toContain("bottle");
  });

  it("returns empty array for empty string", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("strips ILIKE-unsafe characters from keywords", () => {
    for (const kw of extractKeywords("H&M Store 50% off")) {
      expect(kw).not.toMatch(/[%_\\]/);
    }
  });
});

// ─── scoreCandidates ─────────────────────────────────────────────────────────

describe("scoreCandidates", () => {
  const date = "2025-03-15";

  function tx(id: string, amount: number, d: string, merchant: string) {
    return { id, amount, date: d, normalized_merchant: merchant, merchant_name: merchant };
  }

  describe("tiered tolerance — merchant matched", () => {
    it("accepts tx within $5 absolute tolerance", () => {
      // $25 receipt, $28 tx — $3 diff < min($5, 10%*$25=$2.50) → $2.50... wait, $3 > $2.50
      // Actually min($5, $2.50) = $2.50, so $3 diff is rejected. Let's use $27 ($2 diff < $2.50).
      expect(scoreCandidates([tx("t1", 27.00, date, "starbucks")], 25.00, date, "Starbucks")).toBe("t1");
    });

    it("accepts tx within 10% tolerance for larger amounts", () => {
      // $100 receipt, $108 tx — diff $8 < min($5, 10%*$100=$10) = $5 → rejects at $8
      // Use $104 (diff $4 < $5)
      expect(scoreCandidates([tx("t1", 104.00, date, "amazon")], 100.00, date, "Amazon")).toBe("t1");
    });

    it("rejects tx outside min($5, 10%) tolerance", () => {
      // $100 receipt, $115 tx — diff $15 > $5
      expect(scoreCandidates([tx("t1", 115.00, date, "amazon")], 100.00, date, "Amazon")).toBeNull();
    });
  });

  describe("tiered tolerance — no merchant match", () => {
    it("rejects non-matching merchant regardless of amount", () => {
      expect(scoreCandidates([tx("t1", 25.00, date, "lyft")], 25.00, date, "Starbucks")).toBeNull();
    });

    it("uses tight tolerance when no receiptMerchant provided", () => {
      // $5 diff with no merchant → merchantMatched=false → exact $0.01 tolerance
      expect(scoreCandidates([tx("t1", 30.00, date, "anymerchant")], 25.00, date, undefined)).toBeNull();
    });

    it("accepts exact match with no receiptMerchant", () => {
      expect(scoreCandidates([tx("t1", 25.00, date, "anymerchant")], 25.00, date, undefined)).toBe("t1");
    });
  });

  describe("sorting", () => {
    it("picks closer amount when dates are equal", () => {
      expect(scoreCandidates(
        [tx("far", 28.00, date, "starbucks"), tx("near", 25.50, date, "starbucks")],
        25.00, date, "Starbucks"
      )).toBe("near");
    });

    it("picks closer date when amounts are equal", () => {
      expect(scoreCandidates(
        [tx("later", 25.00, "2025-03-20", "starbucks"), tx("sooner", 25.00, "2025-03-16", "starbucks")],
        25.00, date, "Starbucks"
      )).toBe("sooner");
    });
  });

  it("returns null for empty candidates", () => {
    expect(scoreCandidates([], 25.00, date, "Starbucks")).toBeNull();
  });
});

// ─── Realistic match scenarios ────────────────────────────────────────────────

describe("Realistic match scenarios", () => {
  function tx(id: string, amount: number, date: string, merchant: string) {
    return { id, amount, date, normalized_merchant: merchant, merchant_name: merchant };
  }

  it("SQ *MENSHO matches Mensho Tokyo SF receipt", () => {
    expect(merchantsMatch("Mensho Tokyo SF", "SQ *MENSHO")).toBe(true);
    expect(scoreCandidates(
      [tx("wrong", 15.00, "2025-03-15", "some other"), tx("correct", 42.50, "2025-03-15", "mensho")],
      42.50, "2025-03-14", "Mensho Tokyo SF"
    )).toBe("correct");
  });

  it("Amazon receipt matches AMZN*MKTP US tx", () => {
    expect(scoreCandidates(
      [tx("wrong", 99.00, "2025-03-10", "target"), tx("correct", 45.99, "2025-03-12", "amzn mktp")],
      45.99, "2025-03-11", "Amazon"
    )).toBe("correct");
  });

  it("Lyft receipt matches LYFT *RIDE tx via alias", () => {
    expect(merchantsMatch("Lyft", "LYFT *RIDE")).toBe(true);
  });

  it("prefers temporally closer tx when amounts are identical", () => {
    expect(scoreCandidates(
      [tx("old", 50.00, "2025-03-10", "starbucks"), tx("new", 50.00, "2025-03-16", "starbucks")],
      50.00, "2025-03-15", "Starbucks"
    )).toBe("new");
  });

  it("Airbnb receipt does NOT match Clipper tx (known conflict)", () => {
    expect(merchantsMatch("Airbnb", "Clipper")).toBe(false);
    expect(scoreCandidates(
      [tx("clipper", 50.00, "2025-03-15", "clipper card")],
      50.00, "2025-03-15", "Airbnb"
    )).toBeNull();
  });

  it("CVS receipt matches CVS PHARMACY tx", () => {
    expect(scoreCandidates(
      [tx("t1", 12.50, "2025-03-15", "cvs pharmacy")],
      12.50, "2025-03-15", "CVS"
    )).toBe("t1");
  });

  it("Spotify receipt does not match Hulu tx (different groups)", () => {
    expect(scoreCandidates(
      [tx("hulu", 14.99, "2025-03-15", "hulu"), tx("spotify", 9.99, "2025-03-15", "spotify usa")],
      9.99, "2025-03-15", "Spotify"
    )).toBe("spotify");
  });

  it("Seamless receipt matches Grubhub tx via alias", () => {
    expect(merchantsMatch("Seamless", "GRUBHUB")).toBe(true);
  });

  it("TST* restaurant receipt matches via POS stripping", () => {
    expect(scoreCandidates(
      [tx("t1", 67.40, "2025-03-15", "tartine manufactory")],
      67.40, "2025-03-14", "TST*TARTINE MANUFACTORY"
    )).toBe("t1");
  });
});
