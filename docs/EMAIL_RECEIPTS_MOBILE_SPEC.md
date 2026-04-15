# Email Receipts — Mobile Implementation Spec

> Full specification for replicating the email receipt feature in the mobile app (coconut-app).
> The backend API is shared — this doc covers what the mobile app needs to call, display, and handle.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Gmail OAuth Flow](#2-gmail-oauth-flow)
3. [Scanning Pipeline](#3-scanning-pipeline)
4. [API Endpoints](#4-api-endpoints)
5. [Receipt Data Shapes](#5-receipt-data-shapes)
6. [Merchant Types & Specialized Data](#6-merchant-types--specialized-data)
7. [Transaction ↔ Receipt Linking](#7-transaction--receipt-linking)
8. [Rideshare Receipts (Uber/Lyft Maps)](#8-rideshare-receipts-uberlyft-maps)
9. [Food Delivery Receipts](#9-food-delivery-receipts)
10. [E-Commerce Receipts](#10-e-commerce-receipts)
11. [SaaS/Subscription Receipts](#11-saassubscription-receipts)
12. [UI Components & Screens](#12-ui-components--screens)
13. [Database Schema](#13-database-schema)
14. [Error Handling](#14-error-handling)

---

## 1. Architecture Overview

```
User's Gmail ─→ Gmail API ─→ Backend Parser (LLM) ─→ email_receipts table
                                    │
                                    ├─→ Merchant type detection (rideshare, food_delivery, etc.)
                                    ├─→ Specialized prompts per merchant type
                                    ├─→ Map URL extraction (Uber/Lyft)
                                    └─→ Auto-match to Plaid transactions
```

**Flow:**
1. User connects Gmail via OAuth (one-time)
2. Backend scans inbox for receipt emails (keyword + domain matching)
3. Each email is parsed by an LLM with merchant-specific prompts
4. Parsed receipts are stored with `merchant_type` and `merchant_details` JSONB
5. Receipts are auto-matched to Plaid transactions by merchant name + amount + date
6. Mobile app reads receipts via API and renders them

**Key backend files** (for reference, no mobile changes needed):
- `lib/receipt-parser.ts` — Gmail scan + LLM parsing pipeline
- `lib/receipt-merchants.ts` — Merchant detection + specialized prompts
- `lib/receipt-matcher.ts` — Transaction matching algorithm
- `lib/google-auth.ts` — OAuth token management

---

## 2. Gmail OAuth Flow

### Connect

```
Mobile                          Backend                         Google
  │                                │                               │
  ├─ GET /api/gmail/auth ─────────→│                               │
  │  ?redirect=coconut://settings  │                               │
  │                                │                               │
  │←── { authUrl: "https://..." } ─┤                               │
  │                                │                               │
  ├─ Open authUrl in browser ──────────────────────────────────────→│
  │                                │                               │
  │                                │←── callback with code ────────┤
  │                                │                               │
  │                                ├─ Exchange code for tokens     │
  │                                ├─ Encrypt & store tokens       │
  │                                │                               │
  │←── Deep link: coconut://settings?connected=true ───────────────┤
```

**Endpoints:**
- `GET /api/gmail/auth?redirect=coconut://settings` → `{ authUrl }`
- Callback handled server-side → redirects to `coconut://connected?connected=true` or `coconut://settings?error=auth_failed`

### Check Status

```
GET /api/gmail/status
→ { connected: boolean, email: string | null, lastScanAt: string | null }
```

### Disconnect

```
POST /api/gmail/disconnect
→ { ok: true }
```
Deletes tokens, clears receipt→transaction links, deletes all receipts for user.

---

## 3. Scanning Pipeline

### Trigger a Scan

```
POST /api/gmail/scan
Body: { daysBack?: number, detailed?: boolean, forceRescan?: boolean }
→ ScanStats
```

**Default `daysBack`: 7.** For first-time connect, consider `daysBack: 30` to catch recent history.

**Response:**
```typescript
{
  emailsFetched: number    // Total emails found matching receipt keywords
  alreadyProcessed: number // Skipped (already parsed or logged)
  parsed: number           // Successfully parsed as receipts
  notReceipt: number       // LLM determined not a receipt
  noBody: number           // Email had no extractable body
  parseErrors: number      // LLM parsing failed
  insertErrors: number     // DB insert failed
  inserted: number         // New receipts stored
  matched: number          // Auto-matched to transactions
}
```

### What Gets Scanned

**Keywords searched:** receipt, order confirmation, payment confirmation, purchase confirmation, invoice, billing statement, your order, order summary, payment received, transaction receipt

**Merchant domains:** 80+ domains including Amazon, Uber, DoorDash, Spotify, Netflix, etc.

**Excluded:** Investment platforms (Wealthsimple, Questrade), trade confirmations, dividends, payroll, shipping-only notifications, spam

**Special:** Amazon emails are only parsed if subject starts with "Ordered:" (Shipped/Delivered are skipped to prevent duplicates)

### How Parsing Works

1. Email body decoded from MIME (HTML preferred, plain text fallback)
2. **Map image URLs preserved** before HTML stripping (Google Maps, Uber Maps, Lyft Maps, Mapbox)
3. PII scrubbed (credit card numbers, SSN, phone numbers, emails)
4. Merchant type detected from sender domain + subject hints
5. LLM parses with merchant-specific prompt (OpenAI gpt-4o-mini)
6. Receipt stored with `merchant_type` and `merchant_details` JSONB
7. Auto-matched to Plaid transactions

---

## 4. API Endpoints

### Receipt List

```
GET /api/email-receipts
→ { receipts: Receipt[], count: number }
```
Returns all receipts for user, newest first, max 100. Filters out excluded senders.

### Receipt Detail (for rendering)

```
GET /api/email-receipts/:id
→ ReceiptDetail (normalized shape for mobile rendering)
```

This is the primary endpoint for the receipt detail screen. See [Section 5](#5-receipt-data-shapes) for the full response shape.

### Receipt by Transaction

```
GET /api/email-receipts/by-transaction?transactionId=<uuid>
→ { receipt: Receipt | null }
```
Returns raw receipt row. Use `/api/email-receipts/:id` for the normalized rendering shape.

### Manual Match/Unmatch

```
POST /api/email-receipts/:id/match
Body: { transactionId: "uuid" }
→ { ok: true }

DELETE /api/email-receipts/:id/match
→ { ok: true }
```

### Transaction → Receipt Link

Each transaction from `GET /api/plaid/transactions` includes:
```typescript
{
  hasReceipt: boolean,           // true if a receipt is linked
  receipt_id: string | null,     // email_receipts.id (use for detail fetch)
  receiptMatchLine: string,      // one-liner preview, e.g. "Uber: 123 Main → 456 Market"
}
```

---

## 5. Receipt Data Shapes

### `GET /api/email-receipts/:id` Response

```typescript
{
  id: string
  merchant_name: string              // "Uber", "Amazon", "Spotify"
  merchant_type?: string             // "rideshare" | "food_delivery" | "ecommerce" | "saas" | "retail"
  subtotal: number                   // 0 if unknown
  tax: number                        // 0 if unknown
  tip: number                        // from merchant_details.tip, 0 if none
  total: number                      // from email_receipts.amount

  extras: Array<{                    // Additional fees (delivery, service, surge, etc.)
    name: string                     // "Delivery fee", "Service fee", "Surge", "Tolls", "Booking fee"
    amount: number
  }>

  rideshare?: {                      // ONLY present when merchant_type === "rideshare"
    map_url?: string                 // Static map image URL (Google/Uber/Lyft/Mapbox)
    pickup?: string                  // "123 Main St, Toronto"
    dropoff?: string                 // "456 Market St, Toronto"
    distance?: string                // "5.2 mi"
    duration?: string                // "18 min"
    driver_name?: string             // "Ahmed"
    vehicle?: string                 // "Toyota Camry - White"
    fare_breakdown?: {               // Optional granular fare
      base_fare?: number
      distance_charge?: number
      time_charge?: number
      surge?: number
      tolls?: number
      tip?: number
      discount?: number
    }
  }

  receipt_items: Array<{             // Line items (empty [] for rideshare)
    id: string                       // Stable ID: "${receipt.id}-${index}"
    name: string                     // "Big Mac Combo", "AirPods Pro"
    quantity: number                 // Defaults to 1
    unit_price: number
    total_price: number
    sort_order: number               // Index
  }>
}
```

### Raw Receipt Row (from list/by-transaction endpoints)

```typescript
{
  id: string
  clerk_user_id: string
  gmail_message_id: string
  transaction_id: string | null
  merchant: string
  amount: number
  date: string                       // "2026-03-20"
  currency: string                   // "USD"
  subtotal: number | null
  tax: number | null
  order_number: string | null
  match_source: "auto" | "manual"
  line_items: LineItem[] | null      // Raw JSONB (see below)
  merchant_type: string | null
  merchant_details: object | null    // Raw JSONB (see below)
  raw_subject: string
  raw_from: string
  parsed_at: string
}
```

### `line_items` JSONB Shape (raw, in DB)

```typescript
Array<{
  name: string           // "Burrito Bowl"
  quantity: number       // 1
  unit_price: number     // 12.99
  total: number          // 12.99  (NOTE: "total", not "total_price")
  category: string       // "FOOD_AND_DRINK", "GROCERIES", "ELECTRONICS", etc.
}>
```

The `/api/email-receipts/:id` endpoint maps `total` → `total_price` and adds `id`/`sort_order`.

---

## 6. Merchant Types & Specialized Data

### Detection Logic

Merchant type is detected from the sender's email domain + subject line hints:

| Type | Example Senders | Subject Hints |
|------|----------------|---------------|
| `rideshare` | uber.com, lyft.com | "trip with uber", "ride receipt", "thanks for riding" |
| `food_delivery` | doordash.com, grubhub.com, uber.com | "uber eats", "order from", "delivery receipt" |
| `ecommerce` | amazon.com, walmart.com, target.com | (none needed — domain match) |
| `saas` | spotify.com, netflix.com, openai.com | (none needed) |
| `retail` | nike.com, sephora.com, homedepot.com | (none needed) |
| `generic` | (fallback for unknown senders) | — |

**Key disambiguation:** Uber ride vs Uber Eats is determined by subject line. "trip with uber" → rideshare. "uber eats" / "order from" → food_delivery.

### `merchant_details` JSONB by Type

Stored in `email_receipts.merchant_details`. The `/api/email-receipts/:id` endpoint extracts relevant fields into the structured response (tip, extras, rideshare object).

**Rideshare:**
```json
{
  "provider": "uber",
  "pickup": "123 Main St, Toronto, ON",
  "dropoff": "456 Market St, Toronto, ON",
  "distance": "5.2 mi",
  "duration": "18 min",
  "fare_breakdown": { "base_fare": 3.50, "distance_charge": 4.20, "tip": 3.00 },
  "driver_name": "Ahmed",
  "vehicle": "Toyota Camry - White",
  "map_url": "https://maps.googleapis.com/maps/api/staticmap?..."
}
```

**Food Delivery:**
```json
{
  "provider": "uber_eats",
  "restaurant_name": "McDonald's",
  "delivery_address": "789 Oak Ave",
  "delivery_fee": 3.99,
  "service_fee": 2.50,
  "tip": 4.00,
  "discount": -2.00
}
```

**E-Commerce:**
```json
{
  "provider": "amazon",
  "order_number": "111-2345678-9012345",
  "shipping_cost": 0,
  "estimated_delivery": "2026-03-25",
  "discount": -5.00
}
```

**SaaS:**
```json
{
  "service_name": "Spotify",
  "plan_name": "Premium Individual",
  "billing_period": "monthly",
  "next_billing_date": "2026-04-19",
  "seats": 1
}
```

**Retail:**
```json
{
  "store_name": "Nike",
  "store_location": "Yorkdale Mall, Toronto",
  "payment_method": "Visa ending in 4242"
}
```

---

## 7. Transaction ↔ Receipt Linking

### How Auto-Matching Works

After parsing, the backend runs a two-phase matching algorithm:

**Phase 1 — Keyword Match:**
1. Extract 1-3 keywords from receipt merchant name (min 3 chars, no stop words)
2. Search `transactions.normalized_merchant ILIKE '%keyword%'` within ±7 days of receipt date
3. Score candidates by amount difference (must be within $5 or 10%)
4. Best match wins

**Phase 2 — Amount + Date Fallback:**
1. If Phase 1 finds nothing, search by amount (within $1) and date (within ±7 days)
2. Tighter tolerance than Phase 1

### Mobile Integration

1. `GET /api/plaid/transactions` returns `hasReceipt`, `receipt_id`, `receiptMatchLine` per transaction
2. When user taps a transaction with `hasReceipt: true`:
   - Fetch `GET /api/email-receipts/${receipt_id}`
   - Render the receipt detail screen
3. Manual match: `POST /api/email-receipts/:id/match` with `{ transactionId }`
4. Manual unmatch: `DELETE /api/email-receipts/:id/match`

---

## 8. Rideshare Receipts (Uber/Lyft Maps)

This is the most visually rich receipt type.

### Map Image

The backend preserves static map image URLs from rideshare emails. These are Google Static Maps or provider-specific map services showing the route.

**How it works:**
1. Rideshare emails embed `<img>` tags with static map URLs
2. Before stripping HTML, the parser extracts URLs matching: `maps.googleapis.com`, `maps.uber.com`, `maps.lyft.com`, `mapbox.com`
3. These are preserved as `[MAP_IMAGE: url]` markers in the text sent to the LLM
4. The LLM returns the URL in `merchant_details.map_url`
5. The `/api/email-receipts/:id` endpoint returns it in `rideshare.map_url`

### Mobile Rendering

```
┌─────────────────────────────────┐
│  🚗  Uber                      │
│  Mar 20, 2026                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │   [Static Map Image]      │  │  ← Load from rideshare.map_url
│  │   Route A → B shown       │  │
│  └───────────────────────────┘  │
│                                 │
│  📍 123 Main St, Toronto       │  ← rideshare.pickup
│  📍 456 Market St, Toronto     │  ← rideshare.dropoff
│                                 │
│  Distance: 5.2 mi              │  ← rideshare.distance
│  Duration: 18 min              │  ← rideshare.duration
│  Driver: Ahmed                  │  ← rideshare.driver_name
│  Vehicle: Toyota Camry - White  │  ← rideshare.vehicle
│                                 │
│  ─────────────────────────────  │
│  Base fare          $3.50       │  ← rideshare.fare_breakdown
│  Distance           $4.20       │
│  Surge              $2.00       │
│  ─────────────────────────────  │
│  Subtotal           $9.70       │  ← subtotal
│  Tax                $1.26       │  ← tax
│  Tip                $3.00       │  ← tip
│  ─────────────────────────────  │
│  Total             $13.96       │  ← total
└─────────────────────────────────┘
```

**Note:** `receipt_items` will be `[]` for rideshare. The fare breakdown comes from `rideshare.fare_breakdown`, not line items.

---

## 9. Food Delivery Receipts

### Mobile Rendering

```
┌─────────────────────────────────┐
│  🍔  DoorDash                   │
│  McDonald's                     │  ← from merchant_details.restaurant_name
│  Mar 19, 2026                   │
│                                 │
│  Items:                         │
│  1x Big Mac Combo      $12.99   │  ← receipt_items[]
│  1x McFlurry            $4.99   │
│  2x Chicken McNuggets   $7.98   │
│                                 │
│  ─────────────────────────────  │
│  Subtotal              $25.96   │
│  Delivery fee           $3.99   │  ← extras[]
│  Service fee            $2.50   │  ← extras[]
│  Tax                    $3.37   │
│  Tip                    $4.00   │
│  ─────────────────────────────  │
│  Total                 $39.82   │
└─────────────────────────────────┘
```

The `extras` array contains delivery_fee, service_fee, etc. The `tip` is a top-level field.

---

## 10. E-Commerce Receipts

### Mobile Rendering

```
┌─────────────────────────────────┐
│  🛒  Amazon                     │
│  Order #111-2345678-9012345     │  ← from raw receipt.order_number
│  Mar 18, 2026                   │
│                                 │
│  Items:                         │
│  1x Anker USB-C Cable  $12.99   │  ← receipt_items[]
│  2x Clorox Wipes       $16.98   │
│                                 │
│  ─────────────────────────────  │
│  Subtotal              $29.97   │
│  Shipping               $0.00   │  ← extras[] (if shipping_cost > 0)
│  Tax                    $3.90   │
│  ─────────────────────────────  │
│  Total                 $33.87   │
└─────────────────────────────────┘
```

---

## 11. SaaS/Subscription Receipts

### Mobile Rendering

```
┌─────────────────────────────────┐
│  💳  Spotify                    │
│  Premium Individual             │  ← from merchant_details.plan_name
│  Mar 19, 2026                   │
│                                 │
│  Items:                         │
│  1x Premium Individual $11.99   │  ← receipt_items[] (usually 1 item)
│                                 │
│  ─────────────────────────────  │
│  Subtotal              $11.99   │
│  Tax                    $1.56   │
│  ─────────────────────────────  │
│  Total                 $13.55   │
│                                 │
│  Billing: Monthly               │  ← merchant_details.billing_period
│  Next charge: Apr 19, 2026      │  ← merchant_details.next_billing_date
└─────────────────────────────────┘
```

---

## 12. UI Components & Screens

### Screen 1: Gmail Connection (in Settings)

```
┌─────────────────────────────────┐
│  Email Receipts                 │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📧 Connect Gmail          │  │  ← Calls GET /api/gmail/auth
│  │ Auto-scan receipts from   │  │
│  │ your email                │  │
│  └───────────────────────────┘  │
│                                 │
│  — OR (if connected) —          │
│                                 │
│  Connected: koushik@gmail.com   │  ← GET /api/gmail/status
│  Last scan: 2 hours ago         │
│  [Scan Now]  [Disconnect]       │
└─────────────────────────────────┘
```

### Screen 2: Receipt List

```
GET /api/email-receipts → render list
Each row shows: merchant icon, merchant name, date, amount, merchant_type badge
Tap → navigate to Receipt Detail
```

### Screen 3: Receipt Detail

Render based on `merchant_type`:
- **rideshare** → Map + route + fare breakdown (no line items)
- **food_delivery** → Restaurant name + line items + fees
- **ecommerce** → Order number + line items + shipping
- **saas** → Plan name + billing period + next charge date
- **retail** → Store location + line items
- **generic / null** → Basic line items + totals

### Screen 4: Transaction → Receipt

When user taps a transaction with `hasReceipt: true`:
1. Read `receipt_id` from transaction
2. Fetch `GET /api/email-receipts/${receipt_id}`
3. Show receipt detail inline or as modal

### Merchant Type Icons

| Type | Icon | Color |
|------|------|-------|
| `rideshare` | Car | Blue |
| `food_delivery` | Utensils | Orange |
| `ecommerce` | ShoppingBag | Green |
| `saas` | CreditCard | Purple |
| `retail` | ShoppingBag | Teal |
| generic/null | Receipt | Gray |

---

## 13. Database Schema

### `email_receipts` table

```sql
id                uuid PRIMARY KEY
clerk_user_id     text NOT NULL (indexed)
gmail_message_id  text UNIQUE (indexed)
transaction_id    uuid REFERENCES transactions(id) (nullable, indexed)
merchant          text
amount            decimal(12,2)
date              date
currency          text DEFAULT 'USD'
subtotal          numeric(14,2)
tax               numeric(14,2)
order_number      text
match_source      text DEFAULT 'auto'    -- 'auto' or 'manual'
line_items        jsonb                  -- Array<{name, quantity, unit_price, total, category}>
merchant_type     text                   -- rideshare | food_delivery | ecommerce | saas | retail
merchant_details  jsonb                  -- Type-specific structured data (see Section 6)
raw_subject       text
raw_from          text
parsed_at         timestamptz
```

### `gmail_connections` table

```sql
id               uuid PRIMARY KEY
clerk_user_id    text UNIQUE
email            text
access_token     text (encrypted)
refresh_token    text (encrypted)
token_expiry     timestamptz
last_scan_at     timestamptz
created_at       timestamptz
```

### `gmail_scan_log` table

```sql
id               uuid PRIMARY KEY
clerk_user_id    text (indexed)
gmail_message_id text
subject          text
from_address     text
status           text CHECK (parsed, not_receipt, no_body, parse_error, insert_error)
error_reason     text
created_at       timestamptz
UNIQUE (clerk_user_id, gmail_message_id)
```

---

## 14. Error Handling

### Token Expiry

- If scan returns **403 with `authError: true`**, the Gmail token is expired/revoked
- Mobile should show "Reconnect Gmail" prompt
- Detect: `response.status === 403 && body.authError === true`

### No Receipts

- Scan can return `inserted: 0` — this is normal if no new receipt emails found
- Show "No new receipts" rather than an error

### Rate Limits

- Scan endpoint: 20 requests per 60 seconds per user
- Auth endpoint: 30 requests per 60 seconds per user

### Matching Failures

- Some receipts won't match any transaction (different amount, merchant name mismatch, etc.)
- These show in the receipt list but without a linked transaction
- User can manually match via `POST /api/email-receipts/:id/match`

---

## Appendix: Supported Merchant Domains

### Rideshare (2)
uber.com, lyft.com

### Food Delivery (12)
uber.com (with food hints), doordash.com, grubhub.com, instacart.com, skipthedishes.com, gopuff.com, shipt.com, cornershopapp.com, seamless.com, trycaviar.com, fantuan.com, chowbus.com

### E-Commerce (8)
amazon.com (+ .ca/.uk/.de/.fr/.jp), walmart.com, target.com, bestbuy.com, costco.com, chewy.com, etsy.com, ebay.com, shopify.com

### SaaS (30+)
spotify.com, netflix.com, apple.com, google.com, notion.so, figma.com, slack.com, github.com, zoom.us, dropbox.com, adobe.com, canva.com, openai.com, anthropic.com, vercel.com, netlify.com, heroku.com, digitalocean.com, aws.amazon.com, 1password.com, dashlane.com, bitwarden.com, chatgpt.com, claude.ai, microsoft.com, office365.com, hulu.com, disneyplus.com, hbomax.com, paramountplus.com, crunchyroll.com, youtube.com

### Retail (17)
nike.com, adidas.com, uniqlo.com, zara.com, hm.com, gap.com, oldnavy.com, macys.com, nordstrom.com, sephora.com, ulta.com, bath-body-works.com, homedepot.com, lowes.com, ikea.com, staples.com, officedepot.com, cvs.com, walgreens.com
