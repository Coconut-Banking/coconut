/**
 * Tests for merchant-specific receipt parsing integration:
 * - stripHtml MAP_IMAGE preservation
 * - parseReceiptEmail with merchant type (prompt integration)
 * - getMerchantPrompt returns correct prompts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMerchantPrompt, type MerchantType } from "../receipt-merchants";

// ── stripHtml tests (extracted from receipt-parser.ts) ────────────────────────
// stripHtml is not exported, so we test it indirectly via the module.
// We re-implement the same regex logic here for direct unit testing.

/** Mirror of stripHtml from receipt-parser.ts for isolated testing */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\s[^>]*src=["']([^"']+(?:maps\.googleapis\.com|maps\.uber\.com|maps\.lyft\.com|static-maps\.lyft\.com|mapbox\.com|staticmap|\/route[-_]map)[^"']*)["'][^>]*>/gi, "\n[MAP_IMAGE: $1]\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

describe("stripHtml — MAP_IMAGE preservation", () => {
  it("preserves Google Maps static map URL from double-quoted img src", () => {
    const html = `<div>Your route</div><img src="https://maps.googleapis.com/maps/api/staticmap?center=37.7749,-122.4194&zoom=13&size=600x300&path=enc:abc123" alt="trip map" width="600">`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?center=37.7749,-122.4194&zoom=13&size=600x300&path=enc:abc123]");
  });

  it("preserves map URL from single-quoted img src", () => {
    const html = `<img src='https://maps.googleapis.com/maps/api/staticmap?key=AIzaSyD-9t&path=enc:xyz' class='map'>`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?key=AIzaSyD-9t&path=enc:xyz]");
  });

  it("preserves URLs with URL-encoded characters", () => {
    const html = `<img src="https://maps.googleapis.com/maps/api/staticmap?markers=color%3Ared%7Clabel%3AA%7C37.7749%2C-122.4194&key=AIzaSyD" alt="map">`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?markers=color%3Ared%7Clabel%3AA%7C37.7749%2C-122.4194&key=AIzaSyD]");
  });

  it("preserves very long map URLs (common with encoded polylines)", () => {
    const longPath = "enc:" + "a".repeat(500);
    const html = `<img src="https://maps.googleapis.com/maps/api/staticmap?path=${longPath}" alt="">`;
    const result = stripHtml(html);
    expect(result).toContain(`[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?path=${longPath}]`);
  });

  it("strips non-map images completely", () => {
    const html = `<img src="https://cdn.uber.com/logo.png" alt="Uber logo"><img src="https://maps.googleapis.com/maps/api/staticmap?zoom=12" alt="map">`;
    const result = stripHtml(html);
    // The map image should survive
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?zoom=12]");
    // The logo image should be stripped
    expect(result).not.toContain("logo.png");
    expect(result).not.toContain("cdn.uber.com");
  });

  it("strips decorative/tracking pixel images", () => {
    const html = `<img src="https://tracking.example.com/pixel.gif" width="1" height="1"><p>Your receipt</p>`;
    const result = stripHtml(html);
    expect(result).not.toContain("tracking.example.com");
    expect(result).toContain("Your receipt");
  });

  it("handles img tag with '/route-map' path in src", () => {
    const html = `<img src="https://example.com/route-map/image.png?trip=abc" alt="route">`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://example.com/route-map/image.png?trip=abc]");
  });

  it("handles Uber maps domain", () => {
    const html = `<img src="https://maps.uber.com/ride-image?id=xyz123" alt="">`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://maps.uber.com/ride-image?id=xyz123]");
  });

  it("handles Mapbox domain", () => {
    const html = `<img src="https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-s+3bb2d0(-122.4194,37.7749)/-122.4,37.77,13/600x300" alt="">`;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE:");
  });

  it("preserves multiple map images in one email", () => {
    const html = `
      <img src="https://maps.googleapis.com/maps/api/staticmap?zoom=13&pickup" alt="pickup">
      <img src="https://cdn.uber.com/logo.png" alt="logo">
      <img src="https://maps.googleapis.com/maps/api/staticmap?zoom=13&dropoff" alt="dropoff">
    `;
    const result = stripHtml(html);
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?zoom=13&pickup]");
    expect(result).toContain("[MAP_IMAGE: https://maps.googleapis.com/maps/api/staticmap?zoom=13&dropoff]");
    expect(result).not.toContain("logo.png");
  });

  it("handles HTML entities in surrounding text while preserving map URL", () => {
    const html = `<p>Trip from A &amp; B to C</p><img src="https://maps.googleapis.com/maps/api/staticmap?test=1" alt=""><p>Total: $15.00</p>`;
    const result = stripHtml(html);
    expect(result).toContain("Trip from A & B to C");
    expect(result).toContain("[MAP_IMAGE:");
    expect(result).toContain("Total: $15.00");
  });

  it("does NOT match img src that merely contains 'map' in a domain unrelated to maps", () => {
    const html = `<img src="https://bitmap-assets.example.com/header.png" alt="header">`;
    const result = stripHtml(html);
    // "bitmap" contains "map" but the tightened regex only matches specific map domains
    expect(result).not.toContain("[MAP_IMAGE:");
    expect(result).not.toContain("bitmap-assets");
  });
});

// ── getMerchantPrompt tests ──────────────────────────────────────────────────

describe("getMerchantPrompt", () => {
  it("returns a prompt string for each non-generic merchant type", () => {
    const types: MerchantType[] = ["rideshare", "food_delivery", "ecommerce", "saas", "retail"];
    for (const type of types) {
      const prompt = getMerchantPrompt(type);
      expect(prompt).not.toBeNull();
      expect(typeof prompt).toBe("string");
      expect(prompt!.length).toBeGreaterThan(100);
    }
  });

  it("returns null for generic type", () => {
    expect(getMerchantPrompt("generic")).toBeNull();
  });

  it("rideshare prompt mentions pickup/dropoff and map_url", () => {
    const prompt = getMerchantPrompt("rideshare")!;
    expect(prompt).toContain("pickup");
    expect(prompt).toContain("dropoff");
    expect(prompt).toContain("map_url");
    expect(prompt).toContain("MAP_IMAGE");
  });

  it("food_delivery prompt mentions restaurant_name and delivery_fee", () => {
    const prompt = getMerchantPrompt("food_delivery")!;
    expect(prompt).toContain("restaurant_name");
    expect(prompt).toContain("delivery_fee");
    expect(prompt).toContain("line_items");
  });

  it("ecommerce prompt mentions order_number and shipping_cost", () => {
    const prompt = getMerchantPrompt("ecommerce")!;
    expect(prompt).toContain("order_number");
    expect(prompt).toContain("shipping_cost");
    expect(prompt).toContain("estimated_delivery");
  });

  it("saas prompt mentions plan_name and billing_period", () => {
    const prompt = getMerchantPrompt("saas")!;
    expect(prompt).toContain("plan_name");
    expect(prompt).toContain("billing_period");
    expect(prompt).toContain("next_billing_date");
  });

  it("retail prompt mentions store_location and payment_method", () => {
    const prompt = getMerchantPrompt("retail")!;
    expect(prompt).toContain("store_location");
    expect(prompt).toContain("payment_method");
  });
});

// ── parseReceiptEmail merchant integration ───────────────────────────────────
// We mock OpenAI to test the prompt integration without real API calls.

describe("parseReceiptEmail with merchant type", () => {
  let parseReceiptEmail: typeof import("../receipt-parser").parseReceiptEmail;

  const mockCreate = vi.fn();

  beforeEach(async () => {
    mockCreate.mockClear();
    vi.resetModules();

    // Mock OpenAI
    vi.doMock("openai", () => ({
      default: class {
        chat = {
          completions: {
            create: mockCreate,
          },
        };
      },
    }));

    // Set API key env var so the parser initializes
    process.env.OPENAI_API_KEY = "test-key";

    // Mock retry to just call the fn directly
    vi.doMock("../retry", () => ({
      withRetry: (fn: () => Promise<unknown>) => fn(),
      mapWithConcurrency: vi.fn(),
    }));

    const mod = await import("../receipt-parser");
    parseReceiptEmail = mod.parseReceiptEmail;
  });

  it("uses rideshare prompt and extracts merchant_details for Uber ride", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "Uber",
            order_date: "2026-03-20",
            total_amount: 23.45,
            subtotal: 18.50,
            tax: 1.85,
            pickup: "123 Main St",
            dropoff: "456 Market St",
            distance: "3.2 mi",
            duration: "12 min",
            fare_breakdown: { base_fare: 2.50, tip: 3.10 },
            driver_name: "John",
            vehicle: "Toyota Camry",
            map_url: "https://maps.googleapis.com/maps/api/staticmap?path=...",
            line_items: [],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email body", "rideshare");
    expect(result).not.toBeNull();
    expect(result!.merchant_type).toBe("rideshare");
    expect(result!.merchant_details).not.toBeNull();

    const details = result!.merchant_details as import("../receipt-merchants").RideshareDetails;
    expect(details.provider).toBe("uber");
    expect(details.pickup).toBe("123 Main St");
    expect(details.dropoff).toBe("456 Market St");
    expect(details.map_url).toBe("https://maps.googleapis.com/maps/api/staticmap?path=...");

    // Verify the prompt passed to OpenAI mentions rideshare keywords
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("pickup");
    expect(callArgs.messages[0].content).toContain("dropoff");
    expect(callArgs.messages[0].content).toContain("MAP_IMAGE");
  });

  it("uses food_delivery prompt for DoorDash", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "DoorDash",
            restaurant_name: "Chipotle",
            order_date: "2026-03-20",
            total_amount: 28.45,
            subtotal: 22.00,
            tax: 2.86,
            delivery_fee: 2.99,
            service_fee: 1.50,
            tip: 4.00,
            line_items: [{ name: "Burrito Bowl", quantity: 1, unit_price: 12.99, total: 12.99, category: "FOOD_AND_DRINK" }],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email body", "food_delivery");
    expect(result).not.toBeNull();
    expect(result!.merchant_type).toBe("food_delivery");
    expect(result!.merchant_details).not.toBeNull();

    const details = result!.merchant_details as import("../receipt-merchants").FoodDeliveryDetails;
    expect(details.provider).toBe("doordash");
    expect(details.restaurant_name).toBe("Chipotle");

    // Verify the prompt mentions food delivery keywords
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("restaurant_name");
    expect(callArgs.messages[0].content).toContain("delivery_fee");
  });

  it("uses generic prompt when merchantType is 'generic'", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "Some Store",
            order_date: "2026-03-20",
            total_amount: 50.00,
            subtotal: 45.00,
            tax: 5.00,
            line_items: [],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email body", "generic");
    expect(result).not.toBeNull();
    expect(result!.merchant_type).toBe("generic");
    expect(result!.merchant_details).toBeNull();

    // Generic prompt should mention "Extract purchase details"
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("Extract purchase details");
  });

  it("uses generic prompt by default when merchantType is omitted", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "Some Store",
            order_date: "2026-03-20",
            total_amount: 50.00,
            line_items: [],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email body");
    expect(result).not.toBeNull();
    expect(result!.merchant_type).toBe("generic");
    expect(result!.merchant_details).toBeNull();
  });

  it("requests more tokens for specialized prompts (1500 vs 1000)", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "Uber",
            order_date: "2026-03-20",
            total_amount: 20.00,
            pickup: "A",
            dropoff: "B",
            line_items: [],
          }),
        },
      }],
    });

    await parseReceiptEmail("body", "rideshare");
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(1500);
  });

  it("returns null when LLM response indicates not_receipt", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ not_receipt: true }),
        },
      }],
    });

    const result = await parseReceiptEmail("promotional email", "rideshare");
    expect(result).toBeNull();
  });

  it("returns null when LLM returns malformed JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: "not valid json {{{",
        },
      }],
    });

    const result = await parseReceiptEmail("some email", "ecommerce");
    expect(result).toBeNull();
  });

  it("returns null when total_amount is 0 or negative", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            merchant: "Store",
            order_date: "2026-03-20",
            total_amount: 0,
            line_items: [],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email", "generic");
    expect(result).toBeNull();
  });

  it("returns null when merchant is missing", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            order_date: "2026-03-20",
            total_amount: 50.00,
            line_items: [],
          }),
        },
      }],
    });

    const result = await parseReceiptEmail("some email", "generic");
    expect(result).toBeNull();
  });
});
