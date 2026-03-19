import { vi, describe, it, expect } from "vitest";

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
    embeddings = { create: vi.fn() };
  },
}));

import { buildRichEmbedText } from "../../transaction-sync";

describe("buildRichEmbedText", () => {
  it("generates a rich natural-language document for an expense", () => {
    const text = buildRichEmbedText({
      merchant_name: "Starbucks",
      raw_name: "STARBUCKS #1234",
      normalized_merchant: "starbucks",
      primary_category: "FOOD_AND_DRINK",
      detailed_category: "COFFEE",
      amount: -4.75,
      date: "2026-01-15",
      is_pending: false,
    });

    expect(text).toContain("$4.75 purchase at Starbucks");
    expect(text).toContain("on Thursday, January 15, 2026");
    expect(text).toContain("Category: FOOD AND DRINK > COFFEE");
    expect(text).not.toContain("pending");
  });

  it("generates text for a refund/credit", () => {
    const text = buildRichEmbedText({
      merchant_name: "Amazon",
      raw_name: "AMZN MKTP",
      normalized_merchant: "amazon",
      primary_category: "SHOPPING",
      detailed_category: null,
      amount: 25.0,
      date: "2026-02-10",
      is_pending: false,
    });

    expect(text).toContain("$25.00 refund/credit at Amazon");
    expect(text).toContain("Category: SHOPPING");
  });

  it("includes account information when provided", () => {
    const text = buildRichEmbedText(
      {
        merchant_name: "Netflix",
        raw_name: "NETFLIX.COM",
        normalized_merchant: "netflix",
        primary_category: "ENTERTAINMENT",
        detailed_category: "STREAMING",
        amount: -15.99,
        date: "2026-03-01",
        is_pending: false,
      },
      {
        name: "Chase Sapphire",
        subtype: "credit card",
        mask: "4242",
      },
    );

    expect(text).toContain("from Chase Sapphire credit card ending in 4242");
  });

  it("includes pending flag", () => {
    const text = buildRichEmbedText({
      merchant_name: "Uber",
      raw_name: "UBER *TRIP",
      normalized_merchant: "uber",
      primary_category: "TRANSPORTATION",
      detailed_category: "RIDESHARE",
      amount: -23.5,
      date: "2026-03-18",
      is_pending: true,
    });

    expect(text).toContain("(pending)");
  });

  it("falls back to raw_name when merchant_name is null", () => {
    const text = buildRichEmbedText({
      merchant_name: null,
      raw_name: "SQ *BLUE BOTTLE COFFEE",
      normalized_merchant: "sq blue bottle coffee",
      primary_category: "FOOD_AND_DRINK",
      detailed_category: "COFFEE",
      amount: -6.0,
      date: "2026-03-10",
      is_pending: false,
    });

    expect(text).toContain("at SQ *BLUE BOTTLE COFFEE");
  });

  it("handles null account gracefully", () => {
    const text = buildRichEmbedText(
      {
        merchant_name: "Target",
        raw_name: "TARGET",
        normalized_merchant: "target",
        primary_category: "SHOPPING",
        detailed_category: null,
        amount: -42.0,
        date: "2026-01-01",
        is_pending: false,
      },
      null,
    );

    expect(text).not.toContain("from");
    expect(text).toContain("$42.00 purchase at Target");
  });

  it("falls back to 'Unknown' when both merchant_name and raw_name are null", () => {
    const text = buildRichEmbedText({
      merchant_name: null,
      raw_name: null,
      normalized_merchant: null,
      primary_category: "OTHER",
      detailed_category: null,
      amount: -5.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toContain("at Unknown");
  });

  it("handles zero amount as 'transaction' (not purchase or refund)", () => {
    const text = buildRichEmbedText({
      merchant_name: "Bank Adjustment",
      raw_name: "ADJ",
      normalized_merchant: "bank adjustment",
      primary_category: "OTHER",
      detailed_category: null,
      amount: 0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toContain("$0.00 transaction");
    expect(text).not.toContain("purchase");
    expect(text).not.toContain("refund");
  });

  it("includes 'also known as' when normalized_merchant differs from display name", () => {
    // After LLM normalization, merchant_name might be cleaned up but
    // normalized_merchant was set independently to something different
    const text = buildRichEmbedText({
      merchant_name: "Starbucks Reserve",
      raw_name: "SBX RESERVE #1234",
      normalized_merchant: "starbucks",
      primary_category: "FOOD_AND_DRINK",
      detailed_category: "COFFEE",
      amount: -7.0,
      date: "2026-03-15",
      is_pending: false,
    });

    // "starbucks reserve" auto-normalized != "starbucks", so alias shown
    expect(text).toContain("also known as starbucks");
  });

  it("does NOT include 'also known as' when normalized_merchant matches auto-normalization", () => {
    const text = buildRichEmbedText({
      merchant_name: "Starbucks",
      raw_name: "STARBUCKS",
      normalized_merchant: "starbucks",
      primary_category: "FOOD_AND_DRINK",
      detailed_category: "COFFEE",
      amount: -5.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).not.toContain("also known as");
  });

  it("handles account with only name (no subtype or mask)", () => {
    const text = buildRichEmbedText(
      {
        merchant_name: "Costco",
        raw_name: "COSTCO",
        normalized_merchant: "costco",
        primary_category: "SHOPPING",
        detailed_category: null,
        amount: -150.0,
        date: "2026-02-20",
        is_pending: false,
      },
      { name: "Main Checking", subtype: null, mask: null },
    );

    expect(text).toContain("from Main Checking");
    expect(text).not.toContain("ending in");
  });

  it("handles very large amounts", () => {
    const text = buildRichEmbedText({
      merchant_name: "Rent",
      raw_name: "RENT PAYMENT",
      normalized_merchant: "rent",
      primary_category: "RENT_AND_UTILITIES",
      detailed_category: null,
      amount: -2500.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toContain("$2500.00 purchase at Rent");
  });

  it("handles fractional cents correctly", () => {
    const text = buildRichEmbedText({
      merchant_name: "Gas Station",
      raw_name: "SHELL OIL",
      normalized_merchant: "gas station",
      primary_category: "GAS_AND_FUEL",
      detailed_category: null,
      amount: -45.999,
      date: "2026-03-10",
      is_pending: false,
    });

    expect(text).toContain("$46.00");
  });

  it("category shows only primary when detailed is null", () => {
    const text = buildRichEmbedText({
      merchant_name: "Store",
      raw_name: "STORE",
      normalized_merchant: "store",
      primary_category: "SHOPPING",
      detailed_category: null,
      amount: -20.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toContain("Category: SHOPPING.");
    expect(text).not.toContain(">");
  });

  it("defaults to OTHER when primary_category is null", () => {
    const text = buildRichEmbedText({
      merchant_name: "Unknown Vendor",
      raw_name: "UNKNOWN",
      normalized_merchant: "unknown vendor",
      primary_category: null,
      detailed_category: null,
      amount: -10.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toContain("Category: OTHER");
  });

  it("ends with a period", () => {
    const text = buildRichEmbedText({
      merchant_name: "Test",
      raw_name: "TEST",
      normalized_merchant: "test",
      primary_category: "OTHER",
      detailed_category: null,
      amount: -1.0,
      date: "2026-03-01",
      is_pending: false,
    });

    expect(text).toMatch(/\.$/);
  });
});
