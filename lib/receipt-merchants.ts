/**
 * Merchant-specific email receipt parsing.
 *
 * Detects the merchant type from email sender/subject, then uses a
 * tailored LLM prompt that extracts richer structured data than the
 * generic receipt parser (e.g. ride pickup/dropoff, restaurant name,
 * itemized Amazon order, SaaS plan details).
 */

// ── Merchant type definitions ────────────────────────────────────────────────

export type MerchantType =
  | "rideshare"
  | "food_delivery"
  | "ecommerce"
  | "saas"
  | "retail"
  | "generic";

export interface RideshareDetails {
  provider: "uber" | "lyft";
  pickup: string;
  dropoff: string;
  distance?: string;
  duration?: string;
  fare_breakdown?: {
    base_fare?: number;
    distance_charge?: number;
    time_charge?: number;
    surge?: number;
    tolls?: number;
    tip?: number;
    discount?: number;
  };
  driver_name?: string;
  vehicle?: string;
  map_url?: string;
}

export interface FoodDeliveryDetails {
  provider: "uber_eats" | "doordash" | "grubhub" | "instacart" | "skip";
  restaurant_name: string;
  delivery_address?: string;
  delivery_fee?: number;
  service_fee?: number;
  tip?: number;
  discount?: number;
}

export interface EcommerceDetails {
  provider: "amazon" | "walmart" | "target" | "bestbuy" | "costco" | "other";
  order_number?: string;
  shipping_address?: string;
  shipping_method?: string;
  shipping_cost?: number;
  estimated_delivery?: string;
  discount?: number;
}

export interface SaaSDetails {
  service_name: string;
  plan_name?: string;
  billing_period?: string; // e.g. "monthly", "annual", "Jan 2026 - Feb 2026"
  next_billing_date?: string;
  seats?: number;
}

export interface RetailDetails {
  store_name: string;
  store_location?: string;
  payment_method?: string;
}

export type MerchantDetails =
  | RideshareDetails
  | FoodDeliveryDetails
  | EcommerceDetails
  | SaaSDetails
  | RetailDetails;

// ── Merchant detection ───────────────────────────────────────────────────────

interface MerchantPattern {
  type: MerchantType;
  domains: string[];
  subjectHints?: RegExp[];
}

const MERCHANT_PATTERNS: MerchantPattern[] = [
  // Rideshare — detect Uber rides vs Uber Eats by subject
  {
    type: "rideshare",
    domains: ["uber.com"],
    subjectHints: [/trip with uber/i, /your .* ride/i, /uber trip/i, /ride receipt/i, /thanks for riding/i],
  },
  {
    type: "rideshare",
    domains: ["lyft.com"],
    subjectHints: [/ride receipt/i, /your ride/i, /lyft ride/i, /ride with/i],
  },
  // Food delivery
  {
    type: "food_delivery",
    domains: ["uber.com"],
    subjectHints: [/uber eats/i, /your .* order/i, /order from/i, /delivery receipt/i, /food delivery/i],
  },
  {
    type: "food_delivery",
    domains: ["doordash.com"],
  },
  {
    type: "food_delivery",
    domains: ["grubhub.com"],
  },
  {
    type: "food_delivery",
    domains: ["instacart.com"],
  },
  {
    type: "food_delivery",
    domains: ["skipthedishes.com"],
  },
  // E-commerce
  {
    type: "ecommerce",
    domains: ["amazon.com", "amazon.ca", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.co.jp"],
  },
  {
    type: "ecommerce",
    domains: ["walmart.com"],
  },
  {
    type: "ecommerce",
    domains: ["target.com"],
  },
  {
    type: "ecommerce",
    domains: ["bestbuy.com", "bestbuy.ca"],
  },
  {
    type: "ecommerce",
    domains: ["costco.com"],
  },
  {
    type: "ecommerce",
    domains: ["chewy.com"],
  },
  {
    type: "ecommerce",
    domains: ["etsy.com"],
  },
  {
    type: "ecommerce",
    domains: ["ebay.com"],
  },
  {
    type: "ecommerce",
    domains: ["shopify.com"],
  },
  // SaaS / subscriptions
  {
    type: "saas",
    domains: [
      "spotify.com", "netflix.com", "apple.com", "google.com",
      "notion.so", "figma.com", "slack.com", "github.com",
      "zoom.us", "dropbox.com", "adobe.com", "canva.com",
      "openai.com", "anthropic.com", "vercel.com", "netlify.com",
      "heroku.com", "digitalocean.com", "aws.amazon.com",
      "1password.com", "dashlane.com", "bitwarden.com",
      "chatgpt.com", "claude.ai",
      "microsoft.com", "office365.com",
      "hulu.com", "disneyplus.com", "hbomax.com", "paramountplus.com",
      "crunchyroll.com", "youtube.com",
    ],
  },
  // Retail (brick-and-mortar with email receipts)
  {
    type: "retail",
    domains: [
      "nike.com", "adidas.com", "uniqlo.com", "zara.com", "hm.com",
      "gap.com", "oldnavy.com", "macys.com", "nordstrom.com",
      "sephora.com", "ulta.com", "bath-body-works.com",
      "homedepot.com", "lowes.com", "ikea.com",
      "staples.com", "officedepot.com",
      "cvs.com", "walgreens.com",
    ],
  },
];

/**
 * Detect the merchant type from email from-address and subject.
 * For Uber, subject line differentiates rides from Eats orders.
 */
export function detectMerchantType(from: string, subject: string): MerchantType {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();

  for (const pattern of MERCHANT_PATTERNS) {
    const domainMatch = pattern.domains.some((d) => fromLower.includes(d));
    if (!domainMatch) continue;

    // If there are subject hints, at least one must match
    if (pattern.subjectHints) {
      if (pattern.subjectHints.some((re) => re.test(subjectLower))) {
        return pattern.type;
      }
      continue; // Domain matched but subject didn't — try next pattern
    }

    return pattern.type;
  }

  return "generic";
}

// ── Merchant-specific prompts ────────────────────────────────────────────────

const RIDESHARE_PROMPT = `Extract ride receipt details from this email. Return ONLY valid JSON.

If this is NOT a ride receipt (e.g. it's a food delivery, promotion, or account notification), return {"not_receipt": true}.

Extract:
- merchant: "Uber" or "Lyft"
- order_date: YYYY-MM-DD
- total_amount: total charged (number)
- subtotal: fare before tip (number or null)
- tax: tax amount (number or null)
- pickup: full pickup address or location name
- dropoff: full dropoff address or location name
- distance: trip distance with units (e.g. "5.2 mi") or null
- duration: trip duration (e.g. "18 min") or null
- fare_breakdown: object with any of: base_fare, distance_charge, time_charge, surge, tolls, tip, discount (all numbers, null if not found)
- driver_name: driver's first name or null
- vehicle: vehicle description (e.g. "Toyota Camry") or null
- map_url: any map image URL found in the email, or null
- line_items: [] (empty array for rides)

Schema:
{
  "merchant": "Uber",
  "order_date": "YYYY-MM-DD",
  "total_amount": 23.45,
  "subtotal": 18.50,
  "tax": 1.85,
  "pickup": "123 Main St, San Francisco, CA",
  "dropoff": "456 Market St, San Francisco, CA",
  "distance": "3.2 mi",
  "duration": "12 min",
  "fare_breakdown": {"base_fare": 2.50, "distance_charge": 8.40, "time_charge": 5.60, "surge": 2.00, "tip": 3.10},
  "driver_name": "John",
  "vehicle": "Toyota Camry",
  "map_url": "https://...",
  "line_items": []
}`;

const FOOD_DELIVERY_PROMPT = `Extract food delivery receipt details from this email. Return ONLY valid JSON.

If this is NOT a food order receipt, return {"not_receipt": true}.

Extract:
- merchant: the delivery platform (e.g. "Uber Eats", "DoorDash", "Grubhub", "Instacart", "SkipTheDishes")
- restaurant_name: the restaurant or store name the food was ordered from
- order_date: YYYY-MM-DD
- total_amount: total charged (number)
- subtotal: food subtotal before fees/tax (number or null)
- tax: tax amount (number or null)
- delivery_fee: delivery fee (number or null)
- service_fee: service/platform fee (number or null)
- tip: tip amount (number or null)
- discount: any discount or promo applied (number or null)
- delivery_address: delivery address if shown, or null
- order_number: order/confirmation number or null
- line_items: array of food items ordered:
  [{"name": "Big Mac Combo", "quantity": 1, "unit_price": 12.99, "total": 12.99, "category": "FOOD_AND_DRINK"}]

Schema:
{
  "merchant": "Uber Eats",
  "restaurant_name": "McDonald's",
  "order_date": "YYYY-MM-DD",
  "total_amount": 28.45,
  "subtotal": 22.00,
  "tax": 2.86,
  "delivery_fee": 2.99,
  "service_fee": 1.50,
  "tip": 4.00,
  "discount": -5.00,
  "delivery_address": "789 Oak Ave",
  "order_number": "UE-123456",
  "line_items": [{"name": "Big Mac Combo", "quantity": 1, "unit_price": 12.99, "total": 12.99, "category": "FOOD_AND_DRINK"}]
}`;

const ECOMMERCE_PROMPT = `Extract online shopping receipt details from this email. Return ONLY valid JSON.

If this is NOT an order/purchase receipt (e.g. it's a shipping notification, review request, or promo), return {"not_receipt": true}.
Only parse if money was charged — "Your order has been placed" with a total IS a receipt.

Extract:
- merchant: store name (e.g. "Amazon", "Walmart", "Best Buy")
- order_date: YYYY-MM-DD
- total_amount: total charged (number)
- subtotal: pre-tax subtotal (number or null)
- tax: tax amount (number or null)
- order_number: order/confirmation number or null
- shipping_cost: shipping fee (number, 0 if free shipping, null if not shown)
- discount: any discount/coupon applied (number or null)
- estimated_delivery: estimated delivery date or range if shown, or null
- line_items: EVERY individual product ordered with exact product names:
  [{"name": "Apple AirPods Pro (2nd Gen)", "quantity": 1, "unit_price": 249.99, "total": 249.99, "category": "ELECTRONICS"}]

IMPORTANT: Extract ALL items. For Amazon orders, capture the full product name as shown.
Assign each item a category from: FOOD_AND_DRINK, GROCERIES, ENTERTAINMENT, SHOPPING,
TRANSPORTATION, HEALTH_AND_FITNESS, HOUSEHOLD, ELECTRONICS, PERSONAL_CARE, OTHER

Schema:
{
  "merchant": "Amazon",
  "order_date": "YYYY-MM-DD",
  "total_amount": 87.42,
  "subtotal": 79.98,
  "tax": 7.44,
  "order_number": "112-3456789-0123456",
  "shipping_cost": 0,
  "discount": null,
  "estimated_delivery": "March 25-27",
  "line_items": [
    {"name": "Anker USB-C Cable 6ft (2-Pack)", "quantity": 1, "unit_price": 12.99, "total": 12.99, "category": "ELECTRONICS"},
    {"name": "Clorox Disinfecting Wipes", "quantity": 2, "unit_price": 8.49, "total": 16.98, "category": "HOUSEHOLD"}
  ]
}`;

const SAAS_PROMPT = `Extract subscription/SaaS payment details from this email. Return ONLY valid JSON.

If this is NOT a payment receipt or billing notification, return {"not_receipt": true}.
NOT receipts: welcome emails, feature announcements, security alerts, password resets.

Extract:
- merchant: service name (e.g. "Spotify", "Netflix", "OpenAI", "Notion")
- order_date: YYYY-MM-DD (billing date)
- total_amount: amount charged (number)
- subtotal: pre-tax amount or null
- tax: tax amount or null
- order_number: invoice/receipt number or null
- service_name: full service name
- plan_name: plan/tier name (e.g. "Premium", "Pro", "Individual") or null
- billing_period: billing period description (e.g. "Monthly", "Annual", "Jan 1 - Feb 1, 2026") or null
- next_billing_date: next charge date (YYYY-MM-DD) or null
- seats: number of seats/licenses if applicable, or null
- line_items: typically one item for the subscription:
  [{"name": "Spotify Premium - Individual", "quantity": 1, "unit_price": 11.99, "total": 11.99, "category": "ENTERTAINMENT"}]

Category guide: music/video streaming = ENTERTAINMENT, productivity = OTHER, cloud/dev tools = OTHER,
health/fitness apps = HEALTH_AND_FITNESS, food delivery pass = FOOD_AND_DRINK

Schema:
{
  "merchant": "Spotify",
  "order_date": "YYYY-MM-DD",
  "total_amount": 11.99,
  "subtotal": 11.99,
  "tax": null,
  "order_number": "INV-12345",
  "service_name": "Spotify",
  "plan_name": "Premium Individual",
  "billing_period": "Monthly",
  "next_billing_date": "2026-04-23",
  "seats": null,
  "line_items": [{"name": "Premium Individual", "quantity": 1, "unit_price": 11.99, "total": 11.99, "category": "ENTERTAINMENT"}]
}`;

const RETAIL_PROMPT = `Extract retail store receipt details from this email. Return ONLY valid JSON.

If this is NOT a purchase receipt, return {"not_receipt": true}.

Extract:
- merchant: store name (e.g. "Nike", "Sephora", "Home Depot")
- order_date: YYYY-MM-DD
- total_amount: total charged (number)
- subtotal: pre-tax subtotal or null
- tax: tax amount or null
- order_number: order/receipt number or null
- store_name: full store name
- store_location: store location/address if shown, or null
- payment_method: payment method used if shown (e.g. "Visa ending in 4242") or null
- shipping_cost: shipping fee (number or null) — 0 if free or in-store pickup
- line_items: each item purchased with product name and price:
  [{"name": "Nike Air Max 90", "quantity": 1, "unit_price": 130.00, "total": 130.00, "category": "SHOPPING"}]

Category guide: clothing/shoes = SHOPPING, cosmetics = PERSONAL_CARE,
home improvement/furniture = HOUSEHOLD, pharmacy = HEALTH_AND_FITNESS, office supplies = OTHER

Schema:
{
  "merchant": "Nike",
  "order_date": "YYYY-MM-DD",
  "total_amount": 143.50,
  "subtotal": 130.00,
  "tax": 13.50,
  "order_number": "NKE-789456",
  "store_name": "Nike",
  "store_location": "San Francisco Premium Outlets",
  "payment_method": "Visa ending in 4242",
  "shipping_cost": 0,
  "line_items": [{"name": "Air Max 90 - White/Black", "quantity": 1, "unit_price": 130.00, "total": 130.00, "category": "SHOPPING"}]
}`;

/**
 * Get the specialized LLM prompt for a merchant type.
 * Falls back to null for "generic" (uses the existing generic prompt).
 */
export function getMerchantPrompt(type: MerchantType): string | null {
  switch (type) {
    case "rideshare": return RIDESHARE_PROMPT;
    case "food_delivery": return FOOD_DELIVERY_PROMPT;
    case "ecommerce": return ECOMMERCE_PROMPT;
    case "saas": return SAAS_PROMPT;
    case "retail": return RETAIL_PROMPT;
    case "generic": return null;
  }
}

/**
 * Extract merchant_details from the LLM response based on merchant type.
 * Pulls out the type-specific fields that go into the merchant_details JSONB column.
 */
export function extractMerchantDetails(
  type: MerchantType,
  parsed: Record<string, unknown>
): MerchantDetails | null {
  switch (type) {
    case "rideshare": {
      const provider = String(parsed.merchant ?? "").toLowerCase().includes("lyft") ? "lyft" : "uber";
      return {
        provider,
        pickup: String(parsed.pickup ?? ""),
        dropoff: String(parsed.dropoff ?? ""),
        distance: parsed.distance ? String(parsed.distance) : undefined,
        duration: parsed.duration ? String(parsed.duration) : undefined,
        fare_breakdown: parsed.fare_breakdown && typeof parsed.fare_breakdown === "object"
          ? Object.fromEntries(
              Object.entries(parsed.fare_breakdown as Record<string, unknown>)
                .filter(([, v]) => v != null && Number.isFinite(Number(v)))
                .map(([k, v]) => [k, Number(v)])
            ) as RideshareDetails["fare_breakdown"]
          : undefined,
        driver_name: parsed.driver_name ? String(parsed.driver_name) : undefined,
        vehicle: parsed.vehicle ? String(parsed.vehicle) : undefined,
        map_url: parsed.map_url ? String(parsed.map_url) : undefined,
      } satisfies RideshareDetails;
    }
    case "food_delivery": {
      const name = String(parsed.merchant ?? "").toLowerCase();
      const provider = name.includes("doordash") ? "doordash"
        : name.includes("grubhub") ? "grubhub"
        : name.includes("instacart") ? "instacart"
        : name.includes("skip") ? "skip"
        : "uber_eats";
      return {
        provider,
        restaurant_name: String(parsed.restaurant_name ?? parsed.merchant ?? ""),
        delivery_address: parsed.delivery_address ? String(parsed.delivery_address) : undefined,
        delivery_fee: parsed.delivery_fee != null ? Number(parsed.delivery_fee) || undefined : undefined,
        service_fee: parsed.service_fee != null ? Number(parsed.service_fee) || undefined : undefined,
        tip: parsed.tip != null ? Number(parsed.tip) || undefined : undefined,
        discount: parsed.discount != null ? Number(parsed.discount) || undefined : undefined,
      } satisfies FoodDeliveryDetails;
    }
    case "ecommerce": {
      const name = String(parsed.merchant ?? "").toLowerCase();
      const provider = name.includes("amazon") ? "amazon"
        : name.includes("walmart") ? "walmart"
        : name.includes("target") ? "target"
        : name.includes("best buy") ? "bestbuy"
        : name.includes("costco") ? "costco"
        : "other";
      return {
        provider,
        order_number: parsed.order_number ? String(parsed.order_number) : undefined,
        shipping_cost: parsed.shipping_cost != null ? Number(parsed.shipping_cost) : undefined,
        estimated_delivery: parsed.estimated_delivery ? String(parsed.estimated_delivery) : undefined,
        discount: parsed.discount != null ? Number(parsed.discount) || undefined : undefined,
      } satisfies EcommerceDetails;
    }
    case "saas":
      return {
        service_name: String(parsed.service_name ?? parsed.merchant ?? ""),
        plan_name: parsed.plan_name ? String(parsed.plan_name) : undefined,
        billing_period: parsed.billing_period ? String(parsed.billing_period) : undefined,
        next_billing_date: parsed.next_billing_date ? String(parsed.next_billing_date) : undefined,
        seats: parsed.seats != null ? Number(parsed.seats) || undefined : undefined,
      } satisfies SaaSDetails;
    case "retail":
      return {
        store_name: String(parsed.store_name ?? parsed.merchant ?? ""),
        store_location: parsed.store_location ? String(parsed.store_location) : undefined,
        payment_method: parsed.payment_method ? String(parsed.payment_method) : undefined,
      } satisfies RetailDetails;
    default:
      return null;
  }
}
