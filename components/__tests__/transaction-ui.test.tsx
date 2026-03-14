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

  it("shows green + for credit card payment (TRANSFER_OUT)", () => {
    const { container } = render(
      <AmountDisplay
        amount={-150}
        category="Transfer Out"
        merchant="CREDIT CARD PAYMENT"
        rawDescription="Payment to Chase"
      />
    );
    expect(container.textContent).toBe("+$150.00");
    expect(container.querySelector("span")?.className).toContain("emerald");
  });

  it("shows - for Zelle/Venmo TRANSFER_OUT (P2P send)", () => {
    const { container } = render(
      <AmountDisplay
        amount={376}
        category="Transfer Out"
        merchant="Zelle to Aaron Real"
        rawDescription="Zelle payment"
      />
    );
    expect(container.textContent).toBe("-$376.00");
    expect(container.querySelector("span")?.className).toContain("gray");
  });
});

describe("MerchantLogo", () => {
  it("renders letter avatar for unknown merchants", () => {
    const { container } = render(<MerchantLogo name="Mission Grocery" color="#000" />);
    expect(container.textContent).toBe("M");
  });

  it("renders logo img for allowlisted merchants", () => {
    const { container } = render(<MerchantLogo name="Lyft" />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.src).toContain("lyft.com");
  });

  it("respects size prop", () => {
    const { container } = render(<MerchantLogo name="Amazon" color="#333" size="lg" />);
    expect(container.querySelector("div")?.className).toContain("w-14");
  });
});
