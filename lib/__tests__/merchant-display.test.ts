import { describe, it, expect } from "vitest";
import { cleanMerchantForDisplay } from "../merchant-display";

describe("cleanMerchantForDisplay", () => {
  it("cleans wire transfer FROM: Company Via WISE", () => {
    const raw =
      "REAL TIME TRANSFER RECD FROM ABA/CONTR BNK-021000021 FROM: Databricks Inc/Databricks Inc Via WISE REF: 1729208468";
    expect(cleanMerchantForDisplay(raw, "TRANSFER_IN")).toBe("Databricks Inc Pay");
  });

  it("cleans Zelle payment to person", () => {
    expect(
      cleanMerchantForDisplay("Zelle payment to Brendan Eggen JPM99c5ng32u", "TRANSFER_OUT")
    ).toBe("Zelle to Brendan Eggen");
  });

  it("cleans ATM descriptions", () => {
    expect(cleanMerchantForDisplay("NON-CHASE ATM FEE-WITH", "BANK_FEES")).toBe("ATM Fee");
    expect(cleanMerchantForDisplay("NON-CHASE ATM WITHDRAW 001003 02/082729 MISS", "TRANSFER_OUT")).toBe("ATM Withdrawal");
  });

  it("cleans Acc X Acc Fund transfer labels", () => {
    expect(cleanMerchantForDisplay("Acc Kalshi Acc Fund", "TRANSFER_OUT")).toBe("Kalshi Transfer");
  });

  it("cleans income with PPD ID / OSV junk", () => {
    expect(
      cleanMerchantForDisplay("Databricks, -OSV 0000704982 PPD ID: 00010843", "INCOME")
    ).toBe("Databricks Pay");
  });

  it("leaves normal merchants unchanged", () => {
    expect(cleanMerchantForDisplay("Starbucks, Coffee Shop #1234", "FOOD_AND_DRINK")).toBe("Starbucks, Coffee Shop #1234");
    expect(cleanMerchantForDisplay("Lyft", "TRANSPORTATION")).toBe("Lyft");
  });
});
