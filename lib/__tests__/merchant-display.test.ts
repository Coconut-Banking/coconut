import { describe, it, expect } from "vitest";
import { cleanMerchantForDisplay } from "../merchant-display";

describe("cleanMerchantForDisplay", () => {
  it("cleans income with PPD ID / OSV junk", () => {
    expect(
      cleanMerchantForDisplay("Databricks, -OSV 0000704982 PPD ID: 00010843", "INCOME")
    ).toBe("Databricks Pay");
    expect(
      cleanMerchantForDisplay("Databricks, -OSV 0000705541 PPD ID: 00010843", "INCOME")
    ).toBe("Databricks Pay");
  });

  it("cleans TRANSFER_IN with payroll junk", () => {
    expect(
      cleanMerchantForDisplay("Acme Corp, PPD ID 12345", "TRANSFER_IN")
    ).toBe("Acme Corp Pay");
  });

  it("leaves non-income transactions unchanged", () => {
    expect(
      cleanMerchantForDisplay("Starbucks, Coffee Shop #1234", "FOOD_AND_DRINK")
    ).toBe("Starbucks, Coffee Shop #1234");
  });

  it("leaves clean income descriptions unchanged", () => {
    expect(
      cleanMerchantForDisplay("Stripe", "INCOME")
    ).toBe("Stripe");
  });
});
