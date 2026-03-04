import OpenAI from "openai";
import { getGmailClient } from "./google-auth";
import { getSupabase } from "./supabase";
import { matchReceiptsToTransactions } from "./receipt-matcher";
import { reEmbedWithReceipts } from "./transaction-sync";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const RECEIPT_SENDERS = [
  "amazon.com", "walmart.com", "target.com", "bestbuy.com",
  "costco.com", "apple.com", "uber.com", "doordash.com",
  "grubhub.com", "instacart.com", "chewy.com", "etsy.com",
  "ebay.com", "homedepot.com", "lowes.com", "nike.com",
  "adidas.com", "nordstrom.com", "macys.com", "sephora.com",
];

function buildGmailQuery(): string {
  const fromPart = RECEIPT_SENDERS.map((s) => `from:${s}`).join(" OR ");
  return `(${fromPart}) subject:(order OR receipt OR confirmation OR shipped)`;
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
  if (!openai) return null;

  // Truncate very long emails to stay within token limits
  const body = emailBody.length > 8000 ? emailBody.slice(0, 8000) : emailBody;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Extract purchase details from this email receipt. Return ONLY valid JSON. If this is not a purchase receipt, return {"not_receipt": true}.

Schema:
{
  "merchant": "store name",
  "order_date": "YYYY-MM-DD",
  "total_amount": number,
  "line_items": [
    {"name": "item name", "quantity": 1, "unit_price": 9.99, "total": 9.99, "category": "general category"}
  ]
}

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
    if (parsed.not_receipt) return null;
    if (!parsed.merchant || !parsed.line_items) return null;

    return {
      merchant: parsed.merchant,
      order_date: parsed.order_date || new Date().toISOString().split("T")[0],
      total_amount: Number(parsed.total_amount) || 0,
      line_items: (parsed.line_items || []).map((item: Record<string, unknown>) => ({
        name: String(item.name || ""),
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        total: Number(item.total) || 0,
        category: String(item.category || "other"),
      })),
    };
  } catch (e) {
    console.warn("[receipt-parser] LLM parse failed:", e);
    return null;
  }
}

export async function scanGmailForReceipts(
  clerkUserId: string
): Promise<{ scanned: number; matched: number; errors: number }> {
  const gmail = await getGmailClient(clerkUserId);
  if (!gmail) throw new Error("Gmail not connected");

  const db = getSupabase();

  // Search for receipt emails
  const query = buildGmailQuery();
  const listResp = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 20,
  });

  const messageIds = (listResp.data.messages || []).map((m) => m.id!).filter(Boolean);
  if (messageIds.length === 0) return { scanned: 0, matched: 0, errors: 0 };

  // Check which ones we've already processed
  const { data: existing } = await db
    .from("email_receipts")
    .select("gmail_message_id")
    .eq("clerk_user_id", clerkUserId)
    .in("gmail_message_id", messageIds);

  const processedIds = new Set((existing || []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
  const newMessageIds = messageIds.filter((id) => !processedIds.has(id));

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

      const parsed = await parseReceiptEmail(body);
      if (!parsed) { scanned++; continue; }

      const headers = payload.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";

      const { data: inserted } = await db.from("email_receipts").insert({
        clerk_user_id: clerkUserId,
        gmail_message_id: msgId,
        merchant: parsed.merchant,
        order_date: parsed.order_date,
        total_amount: parsed.total_amount,
        line_items: parsed.line_items,
        raw_subject: subject,
        raw_from: from,
      }).select("id").single();

      if (inserted) insertedReceiptIds.push(inserted.id);
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
      reEmbedWithReceipts(clerkUserId, txIds).catch((e) =>
        console.warn("[receipt-parser] re-embed failed:", e)
      );
    }
  }

  // Update last scan timestamp
  await db.from("gmail_connections").update({ last_scan_at: new Date().toISOString() }).eq("clerk_user_id", clerkUserId);

  return { scanned, matched, errors };
}
