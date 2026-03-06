// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReceiptEmail } from "./receipt-parser";

// These tests call the real OpenAI API (gpt-4o-mini) and require OPENAI_API_KEY.
// Skip if not set. Run with: OPENAI_API_KEY=sk-... npm run test
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const itLive = hasOpenAI ? it : it.skip;

// ─── Sample receipt emails ──────────────────────────────────────────────────

const AMAZON_RECEIPT = `
<html>
<body>
<h2>Order Confirmation</h2>
<p>Hello Jamie,</p>
<p>Thank you for your order. We'll send a confirmation when your items ship.</p>
<table>
  <tr><td colspan="2"><strong>Order #112-9374625-3847261</strong></td></tr>
  <tr><td colspan="2">Placed on February 20, 2026</td></tr>
</table>
<h3>Order Details</h3>
<table>
  <tr>
    <td>Callaway Golf Clubs Set - Men's Complete 12-Piece</td>
    <td align="right">$349.99</td>
  </tr>
  <tr>
    <td>Titleist Pro V1 Golf Balls (Dozen)</td>
    <td align="right">$49.99</td>
  </tr>
  <tr>
    <td>Nike Dri-FIT Golf Polo - Size L</td>
    <td align="right">$54.99</td>
  </tr>
</table>
<table>
  <tr><td>Subtotal:</td><td align="right">$454.97</td></tr>
  <tr><td>Shipping:</td><td align="right">$0.00</td></tr>
  <tr><td>Tax:</td><td align="right">$36.40</td></tr>
  <tr><td><strong>Order Total:</strong></td><td align="right"><strong>$491.37</strong></td></tr>
</table>
<p>Ship to: Jamie Doe, 123 Main St, San Francisco, CA 94105</p>
<p>Thank you for shopping with us!</p>
<p>Amazon.com</p>
</body>
</html>
`;

const WALMART_RECEIPT = `
<html>
<body>
<div style="max-width:600px;margin:0 auto">
  <h1>Your Walmart.com Order</h1>
  <p>Order #2000456789012 — February 25, 2026</p>
  <h3>Items in this order:</h3>
  <div>
    <p><strong>Great Value Organic Whole Milk, 1 Gallon</strong> — Qty: 2 — $5.98 each</p>
    <p><strong>Bananas, each</strong> — Qty: 6 — $0.27 each</p>
    <p><strong>Tide Pods Laundry Detergent, 42 count</strong> — Qty: 1 — $13.97</p>
    <p><strong>Bounty Paper Towels, 8 rolls</strong> — Qty: 1 — $15.97</p>
  </div>
  <hr/>
  <p>Subtotal: $43.52</p>
  <p>Delivery: FREE</p>
  <p>Tax: $3.48</p>
  <p><strong>Total: $47.00</strong></p>
  <p>Thank you for shopping at Walmart!</p>
</div>
</body>
</html>
`;

const NON_RECEIPT_EMAIL = `
<html>
<body>
<h2>Your Weekly Newsletter</h2>
<p>Hi Jamie, here are this week's top stories...</p>
<ul>
  <li>Stock market hits new high</li>
  <li>New iPhone announced</li>
  <li>Local weather: sunny, 72°F</li>
</ul>
<p>See you next week!</p>
</body>
</html>
`;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("parseReceiptEmail", () => {
  // Fast tests that don't need OpenAI
  it("returns null when OpenAI is not configured", async () => {
    // The module-level openai client is already set (or null) based on env.
    // If OPENAI_API_KEY is not set, parseReceiptEmail should return null.
    if (hasOpenAI) return; // skip this test if key is set
    const result = await parseReceiptEmail(AMAZON_RECEIPT);
    expect(result).toBe(null);
  });

  // Live tests that call OpenAI
  itLive("parses Amazon receipt with golf equipment", async () => {
    const result = await parseReceiptEmail(AMAZON_RECEIPT);
    expect(result).not.toBe(null);
    expect(result!.merchant.toLowerCase()).toContain("amazon");
    expect(result!.line_items.length).toBe(3);

    // Verify it extracted the golf clubs
    const golfItem = result!.line_items.find((i) =>
      i.name.toLowerCase().includes("golf") || i.name.toLowerCase().includes("callaway")
    );
    expect(golfItem).toBeTruthy();
    expect(golfItem!.total).toBeCloseTo(349.99, 1);

    // Verify total
    expect(result!.total_amount).toBeCloseTo(491.37, 0);

    // Verify date
    expect(result!.order_date).toContain("2026-02");
  }, 30000);

  itLive("parses Walmart grocery receipt", async () => {
    const result = await parseReceiptEmail(WALMART_RECEIPT);
    expect(result).not.toBe(null);
    expect(result!.merchant.toLowerCase()).toContain("walmart");
    expect(result!.line_items.length).toBeGreaterThanOrEqual(3);

    // Should find milk
    const milk = result!.line_items.find((i) =>
      i.name.toLowerCase().includes("milk")
    );
    expect(milk).toBeTruthy();

    // Should find tide pods / detergent
    const detergent = result!.line_items.find((i) =>
      i.name.toLowerCase().includes("tide") || i.name.toLowerCase().includes("detergent")
    );
    expect(detergent).toBeTruthy();

    // Total should be close to $47
    expect(result!.total_amount).toBeCloseTo(47.0, 0);
  }, 30000);

  itLive("rejects non-receipt email", async () => {
    const result = await parseReceiptEmail(NON_RECEIPT_EMAIL);
    expect(result).toBe(null);
  }, 30000);

  itLive("handles truncated/partial email body", async () => {
    // Send only the first 200 chars — should still try to parse but likely return null or partial
    const partial = AMAZON_RECEIPT.slice(0, 200);
    const result = await parseReceiptEmail(partial);
    // Either null (couldn't parse) or partial data — both are acceptable
    if (result) {
      expect(result.merchant).toBeTruthy();
    }
  }, 30000);
});
