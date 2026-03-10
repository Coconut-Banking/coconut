import { describe, it, expect } from "vitest";
import { getMerchantLogoDomain } from "../merchant-logos";

describe("getMerchantLogoDomain", () => {
  it("returns domain for Lyft", () => {
    expect(getMerchantLogoDomain("Lyft")).toBe("lyft.com");
    expect(getMerchantLogoDomain("LYFT")).toBe("lyft.com");
    expect(getMerchantLogoDomain("Lyft Inc")).toBe("lyft.com");
  });

  it("returns domain for Uber", () => {
    expect(getMerchantLogoDomain("Uber")).toBe("uber.com");
    expect(getMerchantLogoDomain("UBER EATS")).toBe("uber.com");
  });

  it("returns domain for Apple", () => {
    expect(getMerchantLogoDomain("Apple")).toBe("apple.com");
    expect(getMerchantLogoDomain("Apple Store")).toBe("apple.com");
  });

  it("returns domain for Tesla", () => {
    expect(getMerchantLogoDomain("Tesla")).toBe("tesla.com");
  });

  it("returns domain for Zelle", () => {
    expect(getMerchantLogoDomain("ZELLE PAYMENT TO AARAI")).toBe("zelle.com");
  });

  it("returns null for unknown merchants", () => {
    expect(getMerchantLogoDomain("Mission Grocery")).toBeNull();
    expect(getMerchantLogoDomain("Ellis Cafe Inc")).toBeNull();
    expect(getMerchantLogoDomain("Bandit Dolores Par")).toBeNull();
  });
});
