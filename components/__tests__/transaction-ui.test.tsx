import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AmountDisplay, MerchantLogo } from "../transaction-ui";

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

describe("MerchantLogo", () => {
  it("renders letter avatar", () => {
    const { container } = render(<MerchantLogo name="Starbucks" color="#000" />);
    expect(container.textContent).toBe("S");
  });

  it("respects size prop", () => {
    const { container } = render(<MerchantLogo name="Amazon" color="#333" size="lg" />);
    expect(container.querySelector("div")?.className).toContain("w-14");
  });
});
