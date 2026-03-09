import OpenAI from "openai";
import { getGmailClient } from "./google-auth";
import { getSupabase } from "./supabase";
import { matchReceiptsToTransactions } from "./receipt-matcher";
// import { reEmbedWithReceipts } from "./transaction-sync";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const RECEIPT_SENDERS = [
  // US stores
  "amazon.com", "walmart.com", "target.com", "bestbuy.com",
  "costco.com", "apple.com", "uber.com", "doordash.com",
  "grubhub.com", "instacart.com", "chewy.com", "etsy.com",
  "ebay.com", "homedepot.com", "lowes.com", "nike.com",
  "adidas.com", "nordstrom.com", "macys.com", "sephora.com",
  // Canadian stores
  "loblaws.ca", "nofrills.ca", "foodbasics.ca", "metro.ca",
  "sobeys.com", "lcbo.com", "thebeer.store", "canadiantire.ca",
  "skip.dishes", "ubereats.com", "amazon.ca", "walmart.ca",
  // Generic receipt senders
  "receipt", "order", "confirmation", "invoice", "payment"
];

function buildGmailQuery(): string {
  // Focus on actual purchases and receipts, not just any financial email
  return `(receipt OR "order confirmation" OR "payment confirmation" OR "your order" OR "your purchase" OR invoice OR "has been charged" OR "order total" OR "payment received" OR "thank you for your order" OR "thank you for your purchase" OR billing OR subscription OR "amount due" OR from:amazon.com OR from:amazon.ca OR from:uber.com OR from:doordash.com) -label:spam -label:trash -category:promotions`;
}

function decodeBody(payload: { body?: { data?: string }; parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }> }): string {
  // Try top-level body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  // Try parts (multipart emails)
  if (payload.parts) {
    // Prefer text/html, fall back to text/plain
    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    const part = htmlPart || textPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
  }
  return "";
}

export async function parseReceiptEmail(emailBody: string): Promise<{
  merchant: string;
  order_date: string;
  total_amount: number;
  line_items: Array<{ name: string; quantity: number; unit_price: number; total: number; category: string }>;
} | null> {
  if (!openai) {
    console.error("[receipt-parser] OpenAI API key not configured. Add OPENAI_API_KEY to .env.local");
    return null;
  }

  // Truncate very long emails to stay within token limits - but take more content for better parsing
  const body = emailBody.length > 12000 ? emailBody.slice(0, 12000) : emailBody;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Extract purchase details from this email. Return ONLY valid JSON.

IMPORTANT: Only parse as a receipt if this is an ACTUAL PURCHASE where money was SPENT on goods or services.

NOT receipts (return {"not_receipt": true}):
- Deposit notifications
- Money transfers between accounts
- Thank you messages without purchases
- Marketing emails
- Account statements
- Investment orders (unless it's a fee)

ARE receipts:
- Product purchases (Amazon, stores, etc)
- Service payments (phone bills, subscriptions)
- Food orders (restaurants, delivery)
- Digital purchases

IMPORTANT:
- MUST find the actual dollar amount - look for $XX.XX, "Total:", "Amount:", "Charged:", etc.
- Do NOT use 0.01 as placeholder - if you can't find a real amount, return {"not_receipt": true}
- For Freedom Mobile example: "$126 + $40" means total is $166
- Look for the ACTUAL amount paid, not placeholder values
- Extract merchant name from sender or subject if not in body
- All numeric values must be numbers, not strings
- If the email mentions a specific dollar amount, extract it

Schema:
{
  "merchant": "store/company/service name",
  "order_date": "YYYY-MM-DD",
  "total_amount": number (MUST be the actual amount paid, not a placeholder),
  "line_items": [
    {"name": "item/service name", "quantity": 1, "unit_price": 9.99, "total": 9.99, "category": "category"}
  ]
}

Examples of VALID receipts WITH amounts:
- "Your Freedom Mobile bill of $44.07" → total_amount: 44.07
- "Order total: $29.99" → total_amount: 29.99
- "You've been charged $9.99 for Netflix" → total_amount: 9.99

Examples of NOT receipts (return {"not_receipt": true}):
- "Your transfer is complete" (money transfer, not purchase)
- "Deposit cash at locations" (informational)
- "Thank you for your application" (no purchase)

Examples of valid line_items:
- {"name": "Echo Dot", "quantity": 1, "unit_price": 29.99, "total": 29.99, "category": "electronics"}
- {"name": "USB Cable", "quantity": 2, "unit_price": 9.99, "total": 19.98, "category": "electronics"}

Email body:
${body}`
      }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1000,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed.not_receipt) {
      console.log(`[receipt-parser] AI marked as not_receipt`);
      return null;
    }

    // Must have merchant AND a real amount
    if (!parsed.merchant) {
      console.log(`[receipt-parser] No merchant found in parsed data`);
      return null;
    }

    // Reject if no real amount found
    if (!parsed.total_amount || parsed.total_amount <= 0) {
      console.log(`[receipt-parser] No valid amount found for: ${parsed.merchant}`);
      return null;
    }

    return {
      merchant: parsed.merchant,
      order_date: parsed.order_date || new Date().toISOString().split("T")[0],
      total_amount: Number(parsed.total_amount) || 0,
      line_items: (parsed.line_items || []).map((item: Record<string, unknown>) => {
        const quantity = Number(item.quantity) || 1;
        const unit_price = Number(item.unit_price) || Number(item.price) || 0;
        const total = Number(item.total) || (unit_price * quantity);

        return {
          name: String(item.name || "Item"),
          quantity: quantity,
          unit_price: unit_price,
          total: total,
          category: String(item.category || "other"),
        };
      }),
    };
  } catch (e) {
    console.warn("[receipt-parser] LLM parse failed:", e);
    console.warn("[receipt-parser] Email preview that failed:", emailBody.slice(0, 200));
    return null;
  }
}

export async function scanGmailForReceipts(
  clerkUserId: string,
  daysBack: number = 7,
  detailed: boolean = true,
  forceRescan: boolean = false
): Promise<{ scanned: number; found: number; new: number; matched: number; errors: number; receipts?: any[]; error?: string }> {
  if (!openai) {
    return {
      scanned: 0,
      found: 0,
      new: 0,
      matched: 0,
      errors: 1,
      error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env.local to enable receipt parsing."
    };
  }

  const gmail = await getGmailClient(clerkUserId);
  if (!gmail) throw new Error("Gmail not connected");

  const db = getSupabase();

  // Build query with date filter
  const dateFilter = daysBack > 0 ? ` after:${Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60)}` : "";
  const query = buildGmailQuery() + dateFilter;

  console.log(`[receipt-parser] Searching Gmail with query: ${query.slice(0, 200)}...`);

  const listResp = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 200, // Get even more emails
  });

  const messageIds = (listResp.data.messages || []).map((m) => m.id!).filter(Boolean);
  if (messageIds.length === 0) return { scanned: 0, found: 0, new: 0, matched: 0, errors: 0 };

  let newMessageIds = messageIds;

  if (!forceRescan) {
    // Check which ones we've already processed (skip if force rescan)
    const { data: existing } = await db
      .from("email_receipts")
      .select("gmail_message_id")
      .eq("clerk_user_id", clerkUserId)
      .in("gmail_message_id", messageIds);

    const processedIds = new Set((existing || []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
    newMessageIds = messageIds.filter((id) => !processedIds.has(id));

    if (newMessageIds.length < messageIds.length) {
      console.log(`[receipt-parser] Skipping ${messageIds.length - newMessageIds.length} already processed emails`);
    }
  } else {
    console.log(`[receipt-parser] Force rescan enabled - processing ALL ${messageIds.length} emails`);
  }

  let scanned = 0;
  let errors = 0;
  const insertedReceiptIds: string[] = [];

  for (const msgId of newMessageIds) {
    try {
      const msg = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
      const payload = msg.data.payload;
      if (!payload) continue;

      const body = decodeBody(payload as Parameters<typeof decodeBody>[0]);
      if (!body) continue;

      const headers = payload.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";

      // Special logging for Amazon emails
      if (from.toLowerCase().includes("amazon") || subject.toLowerCase().includes("amazon")) {
        console.log(`[receipt-parser] Found Amazon email - Subject: "${subject}" From: ${from}`);
      }

      const parsed = await parseReceiptEmail(body);
      if (!parsed) {
        // More detailed logging for Amazon failures
        if (from.toLowerCase().includes("amazon") || subject.toLowerCase().includes("amazon")) {
          console.log(`[receipt-parser] FAILED to parse Amazon email ${msgId}`);
          console.log(`  Subject: "${subject}"`);
          console.log(`  From: ${from}`);
          console.log(`  Body preview: ${body.slice(0, 200)}...`);
        } else {
          console.log(`[receipt-parser] Could not parse message ${msgId} - Subject: "${subject.slice(0, 50)}" From: ${from.slice(0, 30)}`);
        }
        scanned++;
        continue;
      }

      console.log(`[receipt-parser] Parsed receipt from ${parsed.merchant} for $${parsed.total_amount}`);

      console.log(`[receipt-parser] ${forceRescan ? 'Upserting' : 'Inserting'} receipt: ${parsed.merchant}, amount: $${parsed.total_amount}, date: ${parsed.order_date}`);

      const receiptData = {
        clerk_user_id: clerkUserId,
        gmail_message_id: msgId,
        merchant: parsed.merchant,
        amount: parsed.total_amount || 0,
        date: parsed.order_date || new Date().toISOString().split("T")[0],
        line_items: parsed.line_items,
        raw_subject: subject,
        raw_from: from,
      };

      const { data: inserted, error: insertError } = forceRescan
        ? await db.from("email_receipts").upsert(receiptData, { onConflict: 'gmail_message_id' }).select("*")
        : await db.from("email_receipts").insert(receiptData).select("*");

      if (insertError) {
        console.error(`[receipt-parser] Failed to insert receipt:`, insertError);
      } else if (inserted && inserted.length > 0) {
        console.log(`[receipt-parser] Successfully inserted receipt with id:`, inserted[0].id);
        insertedReceiptIds.push(inserted[0].id);
      }

      // Note: insertedReceiptIds tracking is now done above
      scanned++;
    } catch (e) {
      console.warn(`[receipt-parser] Failed to process message ${msgId}:`, e);
      errors++;
    }
  }

  // Match receipts to transactions and re-embed
  let matched = 0;
  if (insertedReceiptIds.length > 0) {
    matched = await matchReceiptsToTransactions(clerkUserId, insertedReceiptIds);
    // Re-embed matched transactions so search picks up line items
    const { data: matchedReceipts } = await db
      .from("email_receipts")
      .select("transaction_id")
      .in("id", insertedReceiptIds)
      .not("transaction_id", "is", null);
    const txIds = (matchedReceipts || []).map((r: { transaction_id: string }) => r.transaction_id);
    if (txIds.length > 0) {
      // TODO: Re-embed matched transactions when function is available
      // reEmbedWithReceipts(clerkUserId, txIds).catch((e) =>
      //   console.warn("[receipt-parser] re-embed failed:", e)
      // );
    }
  }

  // Update last scan timestamp
  await db.from("gmail_connections").update({ last_scan_at: new Date().toISOString() }).eq("clerk_user_id", clerkUserId);

  // If detailed, return the receipts as well
  let receipts: any[] = [];
  if (detailed && insertedReceiptIds.length > 0) {
    const { data } = await db
      .from("email_receipts")
      .select("*")
      .in("id", insertedReceiptIds)
      .order("date", { ascending: false });
    receipts = data || [];
  }

  return {
    scanned: messageIds.length,
    found: scanned,
    new: insertedReceiptIds.length,
    matched,
    errors,
    ...(detailed && { receipts })
  };
}
