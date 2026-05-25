import { describe, it, expect } from "vitest";
import { NotAReceiptError } from "../receipt-errors";
import {
  assertIsReceiptClassification,
  assertParsedReceiptHasContent,
  type ReceiptClassification,
} from "../receipt-classify";
import type { ParsedReceipt } from "../receipt-ocr";

describe("assertIsReceiptClassification", () => {
  it("throws NotAReceiptError when is_receipt is false", () => {
    const c: ReceiptClassification = {
      is_receipt: false,
      document_type: "photo",
      confidence: "high",
      user_message: "This looks like a regular photo.",
    };
    expect(() => assertIsReceiptClassification(c)).toThrow(NotAReceiptError);
    try {
      assertIsReceiptClassification(c);
    } catch (e) {
      expect((e as NotAReceiptError).code).toBe("not_a_receipt");
      expect((e as NotAReceiptError).message).toContain("photo");
    }
  });

  it("does not throw when is_receipt is true", () => {
    const c: ReceiptClassification = {
      is_receipt: true,
      document_type: "receipt",
      confidence: "high",
      user_message: "",
    };
    expect(() => assertIsReceiptClassification(c)).not.toThrow();
  });
});

describe("assertParsedReceiptHasContent", () => {
  const empty: ParsedReceipt = {
    merchant_name: "Unknown",
    date: null,
    currency: "USD",
    items: [],
    subtotal: 0,
    tax: 0,
    tip: 0,
    total: 0,
  };

  it("throws on empty parsed receipt", () => {
    expect(() => assertParsedReceiptHasContent(empty)).toThrow(NotAReceiptError);
  });

  it("allows receipt with items", () => {
    expect(() =>
      assertParsedReceiptHasContent({
        ...empty,
        merchant_name: "Cafe",
        items: [
          { name: "Latte", quantity: 1, unit_price: 5, total_price: 5 },
        ],
        total: 5,
      })
    ).not.toThrow();
  });

  it("allows receipt with total only", () => {
    expect(() =>
      assertParsedReceiptHasContent({
        ...empty,
        merchant_name: "Store",
        total: 12.5,
      })
    ).not.toThrow();
  });
});
