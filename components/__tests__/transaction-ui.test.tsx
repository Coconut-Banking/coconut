import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { merchantToDomain, AmountDisplay } from "../transaction-ui";

describe("merchantToDomain", () => {
  it("extracts domain from simple merchant names", () => {
    expect(merchantToDomain("Starbucks")).toBe("starbucks.com");
    expect(merchantToDomain("McDonald's")).toBe("mcdonald.com");
    expect(merchantToDomain("Amazon")).toBe("amazon.com");
  });

  it("strips trailing numbers and hash", () => {
    expect(merchantToDomain("Starbucks #12345")).toBe("starbucks.com");
    expect(merchantToDomain("UBER *TRIP 1234")).toBe("uber.com");
  });

  it("returns null for empty or invalid input", () => {
    expect(merchantToDomain("")).toBeNull();
    expect(merchantToDomain("123")).toBeNull();
  });

  it("handles multi-word merchants", () => {
    expect(merchantToDomain("United Airlines")).toBe("united.com");
  });
});

describe("AmountDisplay", () => {
  it("shows + for positive amounts with green class", () => {
    const { container } = render(<AmountDisplay amount={100} />);
    expect(container.textContent).toBe("+$100.00");
    expect(container.querySelector("span")?.className).toContain("emerald");
  });

  it("shows - for negative amounts with gray class", () => {
    const { container } = render(<AmountDisplay amount={-50.99} />);
    expect(container.textContent).toBe("-$50.99");
    expect(container.querySelector("span")?.className).toContain("gray");
  });

  it("accepts custom className", () => {
    const { container } = render(<AmountDisplay amount={10} className="text-xl" />);
    expect(container.querySelector("span")?.className).toContain("text-xl");
  });
});
