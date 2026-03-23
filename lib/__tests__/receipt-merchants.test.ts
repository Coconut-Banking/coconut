import { describe, it, expect } from "vitest";
import { detectMerchantType } from "../receipt-merchants";

describe("detectMerchantType", () => {
  it("detects Uber ride from subject", () => {
    expect(detectMerchantType("noreply@uber.com", "Your trip with Uber")).toBe("rideshare");
    expect(detectMerchantType("noreply@uber.com", "Thanks for riding with Uber")).toBe("rideshare");
  });

  it("detects Uber Eats from subject", () => {
    expect(detectMerchantType("noreply@uber.com", "Your Uber Eats order")).toBe("food_delivery");
    expect(detectMerchantType("noreply@uber.com", "Order from McDonald's")).toBe("food_delivery");
  });

  it("detects Lyft ride", () => {
    expect(detectMerchantType("no-reply@lyft.com", "Your ride receipt")).toBe("rideshare");
    expect(detectMerchantType("no-reply@lyft.com", "Lyft ride receipt")).toBe("rideshare");
  });

  it("detects DoorDash as food delivery", () => {
    expect(detectMerchantType("no-reply@doordash.com", "Your DoorDash order")).toBe("food_delivery");
  });

  it("detects grocery delivery services", () => {
    expect(detectMerchantType("no-reply@instacart.com", "Your Instacart order")).toBe("food_delivery");
    expect(detectMerchantType("noreply@gopuff.com", "Your Gopuff receipt")).toBe("food_delivery");
    expect(detectMerchantType("no-reply@shipt.com", "Your Shipt delivery")).toBe("food_delivery");
    expect(detectMerchantType("noreply@cornershopapp.com", "Order summary")).toBe("food_delivery");
  });

  it("detects other food delivery platforms", () => {
    expect(detectMerchantType("no-reply@grubhub.com", "Order confirmation")).toBe("food_delivery");
    expect(detectMerchantType("noreply@seamless.com", "Your Seamless order")).toBe("food_delivery");
    expect(detectMerchantType("orders@trycaviar.com", "Receipt")).toBe("food_delivery");
    expect(detectMerchantType("noreply@fantuan.com", "Your order")).toBe("food_delivery");
    expect(detectMerchantType("no-reply@chowbus.com", "Order receipt")).toBe("food_delivery");
    expect(detectMerchantType("no-reply@skipthedishes.com", "Your SkipTheDishes order")).toBe("food_delivery");
  });

  it("detects Amazon as ecommerce", () => {
    expect(detectMerchantType("ship-confirm@amazon.com", "Ordered: AirPods Pro")).toBe("ecommerce");
    expect(detectMerchantType("auto-confirm@amazon.ca", "Ordered: USB Cable")).toBe("ecommerce");
  });

  it("detects SaaS subscriptions", () => {
    expect(detectMerchantType("noreply@spotify.com", "Your Spotify receipt")).toBe("saas");
    expect(detectMerchantType("no-reply@netflix.com", "Payment confirmation")).toBe("saas");
    expect(detectMerchantType("billing@openai.com", "Invoice")).toBe("saas");
  });

  it("detects retail stores", () => {
    expect(detectMerchantType("noreply@nike.com", "Order confirmation")).toBe("retail");
    expect(detectMerchantType("orders@sephora.com", "Your purchase")).toBe("retail");
  });

  it("returns generic for unknown senders", () => {
    expect(detectMerchantType("unknown@randomstore.com", "Receipt")).toBe("generic");
  });

  it("Uber without ride or food subject hints → generic (not false match)", () => {
    // Uber email that doesn't match ride or food hints falls through to generic
    expect(detectMerchantType("noreply@uber.com", "Welcome to Uber")).toBe("generic");
  });
});
