import OpenAI from "openai";
import { getGmailClient } from "./google-auth";
import { getSupabase } from "./supabase";
import { matchReceiptsToTransactions } from "./receipt-matcher";
import { GMAIL, AI } from "./config";

// ─── Pre-filter: skip emails that are clearly not expense receipts ───────────

function isExcludedSender(from: string): boolean {
  const lower = from.toLowerCase();
  return GMAIL.EXCLUDED_SENDERS.some((domain) => lower.includes(domain));
}

function isExcludedSubject(subject: string): boolean {
  return GMAIL.EXCLUDED_SUBJECT_PATTERNS.some((pat) => pat.test(subject));
}

/** Amazon: only "Ordered: " emails are order confirmations. Shipped/Delivered cause double-counting. */
function isExcludedAmazonEmail(from: string, subject: string): boolean {
  const fromLower = from.toLowerCase();
  const isAmazon = GMAIL.AMAZON_DOMAINS.some((d) => fromLower.includes(d));
  if (!isAmazon) return false;
  const prefix = GMAIL.AMAZON_ORDERED_SUBJECT_PREFIX;
  const subTrim = subject.trim();
  return !subTrim.toLowerCase().startsWith(prefix.toLowerCase());
}
import { withRetry, mapWithConcurrency } from "./retry";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ─── Gmail query builder ─────────────────────────────────────────────────────

function buildGmailQuery(): string {
  const keywords = GMAIL.RECEIPT_KEYWORDS.join(" OR ");
  const merchants = GMAIL.RECEIPT_MERCHANTS.map((d) => `from:${d}`).join(" OR ");
  const exclusions = GMAIL.RECEIPT_EXCLUSIONS.join(" ");
  return `(${keywords} OR ${merchants}) ${exclusions}`;
}

// ─── Email body decoding ─────────────────────────────────────────────────────

interface EmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: EmailPart[];
}

/**
 * Recursively walk multipart email structure to extract body content.
 * Handles arbitrary nesting (multipart/mixed > multipart/alternative > text/html).
 */
function collectParts(part: EmailPart, html: string[], plain: string[]): void {
  if (part.body?.data) {
    const decoded = Buffer.from(part.body.data, "base64url").toString("utf-8");
    if (part.mimeType === "text/html") html.push(decoded);
    else if (part.mimeType === "text/plain") plain.push(decoded);
  }
  if (part.parts) {
    for (const child of part.parts) {
      collectParts(child, html, plain);
    }
  }
}

function decodeBody(payload: EmailPart): string {
  const html: string[] = [];
  const plain: string[] = [];
  collectParts(payload, html, plain);

  const raw = html.length > 0 ? html.join("\n") : plain.join("\n");
  if (!raw) return "";

  if (html.length > 0) return stripHtml(raw);
  return raw;
}

/** Strip HTML tags, decode common entities, collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
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

// ─── Scan log types ──────────────────────────────────────────────────────────

export type ScanLogStatus = "parsed" | "not_receipt" | "no_body" | "parse_error" | "insert_error";

interface ScanLogEntry {
  clerk_user_id: string;
  gmail_message_id: string;
  subject: string;
  from_address: string;
  status: ScanLogStatus;
  error_reason: string | null;
}

// ─── PII scrubbing ──────────────────────────────────────────────────────────

function scrubPII(text: string): string {
  return text
    .replace(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?)(\d{4})\b/g, '****-****-****-$2')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]')
    .replace(/\b[A-Za-z0-9._%+-]+@(?!amazon|walmart|target|costco|uber|doordash|instacart|apple|google|bestbuy|chewy|netflix|spotify)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[EMAIL]');
}

// ─── LLM receipt parsing ─────────────────────────────────────────────────────

export async function parseReceiptEmail(emailBody: string): Promise<{
  merchant: string;
  order_date: string;
  total_amount: number;
  line_items: Array<{ name: string; quantity: number; unit_price: number; total: number; category: string }>;
} | null> {
  if (!openai) {
    console.error("[receipt-parser] OpenAI API key not configured");
    return null;
  }

  const body = scrubPII(
    emailBody.length > GMAIL.EMAIL_MAX_CHARS
      ? emailBody.slice(0, GMAIL.EMAIL_MAX_CHARS)
      : emailBody
  );

  const completion = await withRetry(
    () => Promise.race([
      openai!.chat.completions.create({
      model: AI.MODEL,
      messages: [{
        role: "user",
        content: `Extract purchase details from this email. Return ONLY valid JSON.

IMPORTANT: Only parse as a receipt if this is an ACTUAL PURCHASE where money LEFT the user's account to pay for goods or services.

NOT receipts — return {"not_receipt": true} for ALL of these:
- Income / earnings / job payment notifications (e.g. "you earned $X", "you've been paid")
- Investment / brokerage trade confirmations (buy/sell stock, ETF, crypto orders)
- Dividend or interest payments received
- Deposit or direct deposit notifications
- Money transfers between the user's own accounts
- Refund notifications (money coming back, not going out)
- Thank you messages without a purchase
- Marketing / promotional emails
- Account statements or balance summaries
- Password reset, security alerts, shipping updates without a charge

ARE receipts — parse these:
- Product purchases (Amazon, stores, etc.)
- Service payments (phone bills, subscriptions, SaaS)
- Food orders (restaurants, delivery apps)
- Digital purchases (apps, games, media)
- Utility / insurance / rent payments

Rules:
- MUST find the actual dollar amount — look for $XX.XX, "Total:", "Amount:", "Charged:", etc.
- Do NOT use 0.01 as placeholder — if you can't find a real amount, return {"not_receipt": true}
- Look for the ACTUAL amount paid, not placeholder values
- Extract merchant name from sender or subject if not in body
- All numeric values must be numbers, not strings

Schema:
{
  "merchant": "store/company/service name",
  "order_date": "YYYY-MM-DD",
  "total_amount": number,
  "line_items": [
    {"name": "item/service name", "quantity": 1, "unit_price": 9.99, "total": 9.99, "category": "category"}
  ]
}

Email body:
${body}`
      }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1000,
    }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OpenAI request timed out')), 30_000))
    ]),
    { attempts: 3, baseDelayMs: 1000, label: "parseReceiptEmail" }
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;

  let parsed: {
    not_receipt?: boolean;
    merchant?: string;
    total_amount?: number;
    order_date?: string;
    line_items?: Array<Record<string, unknown>>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[receipt-parser] Malformed AI JSON response");
    return null;
  }

  if (parsed.not_receipt) return null;
  if (!parsed.merchant) return null;
  if (!parsed.total_amount || parsed.total_amount <= 0) return null;

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
        quantity,
        unit_price,
        total,
        category: String(item.category || "other"),
      };
    }),
  };
}

// ─── Scan stats ──────────────────────────────────────────────────────────────

export interface ScanStats {
  emailsFetched: number;
  alreadyProcessed: number;
  parsed: number;
  notReceipt: number;
  noBody: number;
  parseErrors: number;
  insertErrors: number;
  inserted: number;
  matched: number;
  receipts?: unknown[];
  error?: string;
}

// ─── Main scan function ──────────────────────────────────────────────────────

export async function scanGmailForReceipts(
  clerkUserId: string,
  daysBack: number = GMAIL.DEFAULT_SCAN_DAYS,
  detailed: boolean = true,
  forceRescan: boolean = false
): Promise<ScanStats> {
  if (!openai) {
    return {
      emailsFetched: 0, alreadyProcessed: 0, parsed: 0, notReceipt: 0,
      noBody: 0, parseErrors: 0, insertErrors: 0, inserted: 0, matched: 0,
      error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env.local to enable receipt parsing.",
    };
  }

  const gmail = await getGmailClient(clerkUserId);
  if (!gmail) throw new Error("Gmail not connected");

  const db = getSupabase();

  const dateFilter = daysBack > 0
    ? ` after:${Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60)}`
    : "";
  const query = buildGmailQuery() + dateFilter;

  console.log(`[receipt-parser] Searching Gmail with query: ${query.slice(0, 300)}...`);

  const listResp = await withRetry(
    () => gmail.users.messages.list({ userId: "me", q: query, maxResults: GMAIL.MAX_RESULTS }),
    { attempts: 3, label: "gmail.messages.list" }
  );

  const messageIds = (listResp.data.messages || []).map((m) => m.id).filter((id): id is string => Boolean(id));
  if (messageIds.length === 0) {
    return {
      emailsFetched: 0, alreadyProcessed: 0, parsed: 0, notReceipt: 0,
      noBody: 0, parseErrors: 0, insertErrors: 0, inserted: 0, matched: 0,
    };
  }

  let newMessageIds = messageIds;
  let alreadyProcessed = 0;

  if (!forceRescan) {
    const { data: existing } = await db
      .from("email_receipts")
      .select("gmail_message_id")
      .eq("clerk_user_id", clerkUserId)
      .in("gmail_message_id", messageIds);

    const processedIds = new Set((existing || []).map((r: { gmail_message_id: string }) => r.gmail_message_id));

    // Also check scan log for previously attempted (non-receipt, errors, etc.)
    const { data: logged } = await db
      .from("gmail_scan_log")
      .select("gmail_message_id")
      .eq("clerk_user_id", clerkUserId)
      .in("gmail_message_id", messageIds);
    const loggedIds = new Set((logged || []).map((r: { gmail_message_id: string }) => r.gmail_message_id));

    newMessageIds = messageIds.filter((id) => !processedIds.has(id) && !loggedIds.has(id));
    alreadyProcessed = messageIds.length - newMessageIds.length;

    if (alreadyProcessed > 0) {
      console.log(`[receipt-parser] Skipping ${alreadyProcessed} already processed emails`);
    }
  }

  // Counters
  let parsed = 0;
  let notReceipt = 0;
  let noBody = 0;
  let parseErrors = 0;
  let insertErrors = 0;
  const insertedReceiptIds: string[] = [];
  const scanLogs: ScanLogEntry[] = [];

  // Process emails with bounded concurrency
  await mapWithConcurrency(
    newMessageIds,
    async (msgId) => {
      try {
        const msg = await withRetry(
          () => gmail.users.messages.get({ userId: "me", id: msgId, format: "full" }),
          { attempts: 2, label: `gmail.get(${msgId})` }
        );

        const payload = msg.data.payload;
        if (!payload) return;

        const headers = payload.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";

        // Pre-filter: skip investment platforms, income notifications, etc.
        if (isExcludedSender(from) || isExcludedSubject(subject)) {
          notReceipt++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "not_receipt",
            error_reason: "Excluded sender or subject pattern",
          });
          return;
        }

        // Amazon: only "Ordered: " = order confirmation. Shipped/Delivered = skip to avoid double-counting.
        if (isExcludedAmazonEmail(from, subject)) {
          notReceipt++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "not_receipt",
            error_reason: "Amazon email not order confirmation (subject must start with 'Ordered: ')",
          });
          return;
        }

        const body = decodeBody(payload as EmailPart);
        if (!body) {
          noBody++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "no_body", error_reason: "Could not decode email body",
          });
          return;
        }

        let receiptData;
        try {
          receiptData = await parseReceiptEmail(body);
        } catch (e) {
          parseErrors++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "parse_error",
            error_reason: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        if (!receiptData) {
          notReceipt++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "not_receipt", error_reason: null,
          });
          return;
        }

        parsed++;

        const row = {
          clerk_user_id: clerkUserId,
          gmail_message_id: msgId,
          merchant: receiptData.merchant,
          amount: receiptData.total_amount || 0,
          date: receiptData.order_date || new Date().toISOString().split("T")[0],
          line_items: receiptData.line_items,
          raw_subject: subject,
          raw_from: from,
        };

        const { data: inserted, error: insertError } = forceRescan
          ? await db.from("email_receipts").upsert(row, { onConflict: "gmail_message_id" }).select("id")
          : await db.from("email_receipts").insert(row).select("id");

        if (insertError) {
          insertErrors++;
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "insert_error",
            error_reason: insertError.message,
          });
          return;
        }

        if (inserted && inserted.length > 0) {
          insertedReceiptIds.push(inserted[0].id);
          scanLogs.push({
            clerk_user_id: clerkUserId, gmail_message_id: msgId,
            subject, from_address: from, status: "parsed", error_reason: null,
          });
        }
      } catch (e) {
        parseErrors++;
        scanLogs.push({
          clerk_user_id: clerkUserId, gmail_message_id: msgId,
          subject: "", from_address: "", status: "parse_error",
          error_reason: e instanceof Error ? e.message : String(e),
        });
      }
    },
    GMAIL.PARSE_CONCURRENCY
  );

  // Persist scan logs in batches (best-effort, don't fail the scan)
  if (scanLogs.length > 0) {
    try {
      await db.from("gmail_scan_log").upsert(
        scanLogs.map((l) => ({ ...l, created_at: new Date().toISOString() })),
        { onConflict: "clerk_user_id,gmail_message_id" }
      );
    } catch (e) {
      console.warn("[receipt-parser] Failed to persist scan logs:", e);
    }
  }

  // Match receipts to transactions
  let matched = 0;
  if (insertedReceiptIds.length > 0) {
    matched = await matchReceiptsToTransactions(clerkUserId, insertedReceiptIds);
  }

  // Update last scan timestamp
  await db.from("gmail_connections")
    .update({ last_scan_at: new Date().toISOString() })
    .eq("clerk_user_id", clerkUserId);

  // Optionally return the inserted receipts
  let receipts: unknown[] = [];
  if (detailed && insertedReceiptIds.length > 0) {
    const { data } = await db
      .from("email_receipts")
      .select("*")
      .in("id", insertedReceiptIds)
      .order("date", { ascending: false });
    receipts = data || [];
  }

  return {
    emailsFetched: messageIds.length,
    alreadyProcessed,
    parsed,
    notReceipt,
    noBody,
    parseErrors,
    insertErrors,
    inserted: insertedReceiptIds.length,
    matched,
    ...(detailed && { receipts }),
  };
}
