import { describe, it, expect } from "vitest";
import { detectMerchantType, extractMerchantDetails } from "../receipt-merchants";
import type {
  RideshareDetails,
  FoodDeliveryDetails,
  EcommerceDetails,
  SaaSDetails,
  RetailDetails,
} from "../receipt-merchants";

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

  it("differentiates Uber ride from Uber Eats by subject (not sender)", () => {
    // Same sender, different subjects — should resolve correctly
    expect(detectMerchantType("noreply@uber.com", "Your Monday ride")).toBe("rideshare");
    expect(detectMerchantType("noreply@uber.com", "Your Uber Eats order from Wendy's")).toBe("food_delivery");
    expect(detectMerchantType("noreply@uber.com", "Food delivery receipt")).toBe("food_delivery");
    expect(detectMerchantType("noreply@uber.com", "Uber trip summary")).toBe("rideshare");
  });

  it("is case-insensitive for from address", () => {
    expect(detectMerchantType("NoReply@UBER.COM", "Trip with Uber")).toBe("rideshare");
    expect(detectMerchantType("ORDERS@DOORDASH.COM", "Your order")).toBe("food_delivery");
    expect(detectMerchantType("Auto-Confirm@Amazon.Com", "Ordered: Laptop")).toBe("ecommerce");
  });

  it("handles emails with display names in from field", () => {
    expect(detectMerchantType("Uber Receipts <noreply@uber.com>", "Your trip with Uber")).toBe("rideshare");
    expect(detectMerchantType("Amazon.com <ship-confirm@amazon.com>", "Ordered: USB cable")).toBe("ecommerce");
  });
});

// ── extractMerchantDetails tests ─────────────────────────────────────────────

describe("extractMerchantDetails", () => {
  describe("rideshare", () => {
    it("extracts Uber ride details from LLM response", () => {
      const parsed = {
        merchant: "Uber",
        pickup: "123 Main St, San Francisco, CA",
        dropoff: "456 Market St, San Francisco, CA",
        distance: "5.2 mi",
        duration: "18 min",
        fare_breakdown: {
          base_fare: 2.50,
          distance_charge: 8.40,
          time_charge: 5.60,
          surge: 2.00,
          tip: 3.10,
        },
        driver_name: "John",
        vehicle: "Toyota Camry",
        map_url: "https://maps.googleapis.com/maps/api/staticmap?path=...",
      };

      const result = extractMerchantDetails("rideshare", parsed) as RideshareDetails;
      expect(result).not.toBeNull();
      expect(result.provider).toBe("uber");
      expect(result.pickup).toBe("123 Main St, San Francisco, CA");
      expect(result.dropoff).toBe("456 Market St, San Francisco, CA");
      expect(result.distance).toBe("5.2 mi");
      expect(result.duration).toBe("18 min");
      expect(result.fare_breakdown).toEqual({
        base_fare: 2.50,
        distance_charge: 8.40,
        time_charge: 5.60,
        surge: 2.00,
        tip: 3.10,
      });
      expect(result.driver_name).toBe("John");
      expect(result.vehicle).toBe("Toyota Camry");
      expect(result.map_url).toBe("https://maps.googleapis.com/maps/api/staticmap?path=...");
    });

    it("detects Lyft provider from merchant name", () => {
      const parsed = { merchant: "Lyft", pickup: "A", dropoff: "B" };
      const result = extractMerchantDetails("rideshare", parsed) as RideshareDetails;
      expect(result.provider).toBe("lyft");
    });

    it("handles missing optional fields gracefully", () => {
      const parsed = { merchant: "Uber", pickup: "A", dropoff: "B" };
      const result = extractMerchantDetails("rideshare", parsed) as RideshareDetails;
      expect(result.provider).toBe("uber");
      expect(result.pickup).toBe("A");
      expect(result.dropoff).toBe("B");
      expect(result.distance).toBeUndefined();
      expect(result.duration).toBeUndefined();
      expect(result.fare_breakdown).toBeUndefined();
      expect(result.driver_name).toBeUndefined();
      expect(result.vehicle).toBeUndefined();
      expect(result.map_url).toBeUndefined();
    });

    it("handles null pickup/dropoff by converting to empty string", () => {
      const parsed = { merchant: "Uber", pickup: null, dropoff: null };
      const result = extractMerchantDetails("rideshare", parsed) as RideshareDetails;
      expect(result.pickup).toBe("");
      expect(result.dropoff).toBe("");
    });

    it("filters non-numeric values from fare_breakdown", () => {
      const parsed = {
        merchant: "Uber",
        pickup: "A",
        dropoff: "B",
        fare_breakdown: {
          base_fare: 5.00,
          surge: null,
          tip: "not a number",
          tolls: 2.50,
          discount: NaN,
        },
      };
      const result = extractMerchantDetails("rideshare", parsed) as RideshareDetails;
      // null is filtered out (v != null), "not a number" passes the filter but Number("not a number") is NaN — Number.isFinite(NaN) is false → filtered
      // NaN is not finite → filtered
      expect(result.fare_breakdown).toEqual({ base_fare: 5.00, tolls: 2.50 });
    });
  });

  describe("food_delivery", () => {
    it("extracts Uber Eats details", () => {
      const parsed = {
        merchant: "Uber Eats",
        restaurant_name: "McDonald's",
        delivery_address: "789 Oak Ave",
        delivery_fee: 2.99,
        service_fee: 1.50,
        tip: 4.00,
        discount: -5.00,
      };
      const result = extractMerchantDetails("food_delivery", parsed) as FoodDeliveryDetails;
      expect(result.provider).toBe("uber_eats");
      expect(result.restaurant_name).toBe("McDonald's");
      expect(result.delivery_address).toBe("789 Oak Ave");
      expect(result.delivery_fee).toBe(2.99);
      expect(result.service_fee).toBe(1.50);
      expect(result.tip).toBe(4.00);
      expect(result.discount).toBe(-5.00);
    });

    it("detects all known food delivery providers", () => {
      const providers = [
        ["DoorDash", "doordash"],
        ["Caviar", "caviar"],
        ["Grubhub", "grubhub"],
        ["Seamless", "seamless"],
        ["Instacart", "instacart"],
        ["SkipTheDishes", "skip"],
        ["Gopuff", "gopuff"],
        ["Shipt", "shipt"],
        ["Cornershop", "cornershop"],
        ["Fantuan", "fantuan"],
        ["Chowbus", "chowbus"],
      ];
      for (const [merchantName, expected] of providers) {
        const result = extractMerchantDetails("food_delivery", {
          merchant: merchantName,
          restaurant_name: "Test Store",
        }) as FoodDeliveryDetails;
        expect(result.provider).toBe(expected);
      }
    });

    it("falls back to 'other' for unknown food delivery provider", () => {
      const result = extractMerchantDetails("food_delivery", {
        merchant: "UnknownApp",
        restaurant_name: "Test",
      }) as FoodDeliveryDetails;
      expect(result.provider).toBe("other");
    });

    it("falls back to merchant name if restaurant_name is missing", () => {
      const result = extractMerchantDetails("food_delivery", {
        merchant: "DoorDash",
      }) as FoodDeliveryDetails;
      expect(result.restaurant_name).toBe("DoorDash");
    });

    it("treats zero tip as undefined (Number(0) || undefined)", () => {
      const result = extractMerchantDetails("food_delivery", {
        merchant: "DoorDash",
        restaurant_name: "Chipotle",
        tip: 0,
      }) as FoodDeliveryDetails;
      // 0 is falsy, so Number(0) || undefined → undefined
      expect(result.tip).toBeUndefined();
    });
  });

  describe("ecommerce", () => {
    it("extracts Amazon order details", () => {
      const parsed = {
        merchant: "Amazon",
        order_number: "112-3456789-0123456",
        shipping_cost: 0,
        estimated_delivery: "March 25-27",
        discount: null,
      };
      const result = extractMerchantDetails("ecommerce", parsed) as EcommerceDetails;
      expect(result.provider).toBe("amazon");
      expect(result.order_number).toBe("112-3456789-0123456");
      expect(result.shipping_cost).toBe(0);
      expect(result.estimated_delivery).toBe("March 25-27");
      expect(result.discount).toBeUndefined();
    });

    it("detects known ecommerce providers", () => {
      const providers = [
        ["Amazon", "amazon"],
        ["Walmart", "walmart"],
        ["Target", "target"],
        ["Best Buy", "bestbuy"],
        ["Costco", "costco"],
      ];
      for (const [name, expected] of providers) {
        const result = extractMerchantDetails("ecommerce", { merchant: name }) as EcommerceDetails;
        expect(result.provider).toBe(expected);
      }
    });

    it("returns 'other' for unknown ecommerce provider", () => {
      const result = extractMerchantDetails("ecommerce", { merchant: "Etsy" }) as EcommerceDetails;
      expect(result.provider).toBe("other");
    });
  });

  describe("saas", () => {
    it("extracts SaaS subscription details", () => {
      const parsed = {
        merchant: "Spotify",
        service_name: "Spotify",
        plan_name: "Premium Individual",
        billing_period: "Monthly",
        next_billing_date: "2026-04-23",
        seats: null,
      };
      const result = extractMerchantDetails("saas", parsed) as SaaSDetails;
      expect(result.service_name).toBe("Spotify");
      expect(result.plan_name).toBe("Premium Individual");
      expect(result.billing_period).toBe("Monthly");
      expect(result.next_billing_date).toBe("2026-04-23");
      expect(result.seats).toBeUndefined();
    });

    it("falls back to merchant for service_name", () => {
      const result = extractMerchantDetails("saas", { merchant: "Netflix" }) as SaaSDetails;
      expect(result.service_name).toBe("Netflix");
    });

    it("handles seats as a number", () => {
      const result = extractMerchantDetails("saas", {
        merchant: "Slack",
        service_name: "Slack",
        seats: 10,
      }) as SaaSDetails;
      expect(result.seats).toBe(10);
    });
  });

  describe("retail", () => {
    it("extracts retail store details", () => {
      const parsed = {
        merchant: "Nike",
        store_name: "Nike",
        store_location: "San Francisco Premium Outlets",
        payment_method: "Visa ending in 4242",
      };
      const result = extractMerchantDetails("retail", parsed) as RetailDetails;
      expect(result.store_name).toBe("Nike");
      expect(result.store_location).toBe("San Francisco Premium Outlets");
      expect(result.payment_method).toBe("Visa ending in 4242");
    });

    it("falls back to merchant for store_name", () => {
      const result = extractMerchantDetails("retail", { merchant: "Sephora" }) as RetailDetails;
      expect(result.store_name).toBe("Sephora");
    });

    it("handles missing optional fields", () => {
      const result = extractMerchantDetails("retail", { merchant: "Nike" }) as RetailDetails;
      expect(result.store_location).toBeUndefined();
      expect(result.payment_method).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("returns null for generic type", () => {
      const result = extractMerchantDetails("generic", { merchant: "SomeStore" });
      expect(result).toBeNull();
    });

    it("handles completely empty parsed object", () => {
      const result = extractMerchantDetails("rideshare", {}) as RideshareDetails;
      expect(result.provider).toBe("uber"); // default when merchant is undefined
      expect(result.pickup).toBe("");
      expect(result.dropoff).toBe("");
    });

    it("handles malformed fare_breakdown (non-object)", () => {
      const result = extractMerchantDetails("rideshare", {
        merchant: "Uber",
        pickup: "A",
        dropoff: "B",
        fare_breakdown: "invalid",
      }) as RideshareDetails;
      expect(result.fare_breakdown).toBeUndefined();
    });

    it("handles numeric strings in fields that expect numbers", () => {
      const result = extractMerchantDetails("food_delivery", {
        merchant: "DoorDash",
        restaurant_name: "Chipotle",
        delivery_fee: "3.99",
        service_fee: "1.50",
        tip: "5.00",
      }) as FoodDeliveryDetails;
      expect(result.delivery_fee).toBe(3.99);
      expect(result.service_fee).toBe(1.50);
      expect(result.tip).toBe(5.00);
    });
  });
});
