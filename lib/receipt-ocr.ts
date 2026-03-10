import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const paddleOcrUrl = process.env.PADDLEOCR_API_URL?.replace(/\/$/, "");
const paddleAistudioToken = process.env.PADDLEOCR_AI_STUDIO_TOKEN;
const paddleAistudioUrl = process.env.PADDLEOCR_AI_STUDIO_URL?.replace(/\/$/, "");

const SYSTEM_PROMPT_IMAGE = `You are a receipt parser. Given a photo of a receipt, extract structured data as JSON.

Return EXACTLY this JSON structure:
{
  "merchant_name": "Restaurant or store name",
  "date": "YYYY-MM-DD or null if unreadable",
  "currency": "USD",
  "items": [
    {
      "name": "Item description",
      "quantity": 1,
      "unit_price": 12.99,
      "total_price": 12.99
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "other_fees": [
    { "name": "Delivery Fee", "amount": 3.99 }
  ],
  "total": 0.00
}

Rules:
- All prices are positive numbers with 2 decimal places.
- If quantity > 1, unit_price is the per-unit price and total_price = quantity * unit_price.
- If tip is not shown on the receipt, set tip to 0.
- If tax is not explicitly shown, set tax to 0.
- If subtotal is not shown, sum all item total_prices.
- Extract every distinct line item. Do not skip items.
- Do not invent items that are not on the receipt.
- For item names, use the exact text from the receipt.
- other_fees: capture any extra fees literally as they appear (delivery fee, service charge, surcharge, convenience fee, etc.). Use exact label and amount from receipt. If none, use [].`;

export interface ParsedReceipt {
  merchant_name: string;
  date: string | null;
  currency: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  subtotal: number;
  tax: number;
  tip: number;
  other_fees?: Array<{ name: string; amount: number }>;
  total: number;
}

const SYSTEM_PROMPT_TEXT = `${SYSTEM_PROMPT_IMAGE}

You are given the OCR-extracted text/markdown from a receipt image. Parse it into the JSON structure above.`;

const CLEAN_PROMPT = `You are a receipt cleaner. You receive raw OCR output that often includes:
- Non-item lines: promos, "THANK YOU", loyalty text, barcodes, store addresses, phone numbers
- Noisy item names: "1X CHKN WNGS 12.99" instead of "Chicken Wings"
- Summary lines mistakenly as items: SUBTOTAL, TAX, TIP, TOTAL

Clean the receipt to be super readable:
1. REMOVE non-purchasable lines. Keep ONLY actual products/services bought.
2. NORMALIZE item names: short, human-readable (e.g. "Chicken Wings" not "1X CHICKEN WINGS 12.99"). Strip prices from names—they're in unit_price/total_price.
3. REMOVE duplicate or meta lines (SUBTOTAL, TAX, TIP, TOTAL if they appear as items).
4. CLEAN merchant_name: store/restaurant name only, no addresses or "Visit us at..."
5. PRESERVE all numbers exactly: subtotal, tax, tip, total, item prices. Do not recalculate.
6. If an item's quantity/unit_price/total_price looks wrong, keep the total_price and derive quantity=1, unit_price=total_price.
7. other_fees: move delivery fee, service charge, surcharge, convenience fee, or any similar line here. Use exact name and amount from receipt. If none, use [].

Return the SAME JSON structure. Items array must only contain real line items.`;

/** Call PaddleOCR AI Studio layout-parsing API; returns markdown text or null. */
async function paddleAistudioOcr(
  imageBase64: string,
  fileType: 0 | 1
): Promise<string | null> {
  if (!paddleAistudioToken || !paddleAistudioUrl) return null;
  try {
    const payload = {
      file: imageBase64,
      fileType,
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    };
    const res = await fetch(paddleAistudioUrl, {
      method: "POST",
      headers: {
        Authorization: `token ${paddleAistudioToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { layoutParsingResults?: Array<{ markdown?: { text?: string } }> };
    };
    const texts = json.result?.layoutParsingResults?.map(
      (r) => r.markdown?.text ?? ""
    );
    return texts?.filter(Boolean).join("\n\n") ?? null;
  } catch (e) {
    console.warn("[receipt-ocr] PaddleOCR AI Studio failed:", e);
    return null;
  }
}

/** LLM cleanup stage: remove irrelevant lines, normalize item names for super clean output. */
async function cleanReceiptWithLLM(parsed: ParsedReceipt): Promise<ParsedReceipt> {
  if (!openai) return parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLEAN_PROMPT },
        {
          role: "user",
          content: `Clean this receipt:\n\n${JSON.stringify(parsed, null, 2)}`,
        },
      ],
      max_tokens: 2000,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw) as ParsedReceipt;
    } catch (parseErr) {
      console.warn("[receipt-ocr] LLM cleanup returned malformed JSON, using raw:", parseErr);
      return parsed;
    }
  } catch (e) {
    console.warn("[receipt-ocr] LLM cleanup failed, returning raw:", e);
    return parsed;
  }
}

/** Parse markdown/text into ParsedReceipt using GPT (cheaper than image). */
async function parseReceiptFromText(text: string): Promise<ParsedReceipt> {
  if (!openai)
    throw new Error(
      "OPENAI_API_KEY required to parse receipt text (PaddleOCR AI Studio returns text)"
    );
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT_TEXT },
      {
        role: "user",
        content: `Parse this receipt text into the required JSON:\n\n${text}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0,
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as ParsedReceipt;
  } catch (e) {
    throw new Error(`[receipt-ocr] Malformed AI response when parsing receipt text: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Try PaddleOCR AI Studio → self-hosted PaddleOCR → GPT-4o Vision. */
export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string
): Promise<ParsedReceipt> {
  // 1. PaddleOCR AI Studio (layout-parsing API)
  if (paddleAistudioToken) {
    const fileType: 0 | 1 = mimeType === "application/pdf" ? 0 : 1;
    const text = await paddleAistudioOcr(imageBase64, fileType);
    if (text && text.trim()) {
      try {
        const parsed = await parseReceiptFromText(text);
        return await cleanReceiptWithLLM(parsed);
      } catch (e) {
        console.warn(
          "[receipt-ocr] GPT parse of PaddleOCR text failed, trying next:",
          e
        );
      }
    }
  }

  // 2. Self-hosted PaddleOCR
  if (paddleOcrUrl) {
    try {
      const buf = Buffer.from(imageBase64, "base64");
      const form = new FormData();
      form.append("image", new Blob([buf], { type: mimeType }), "receipt.png");
      const res = await fetch(`${paddleOcrUrl}/parse`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        const data = (await res.json()) as ParsedReceipt;
        return await cleanReceiptWithLLM(data);
      }
    } catch (e) {
      console.warn("[receipt-ocr] PaddleOCR API failed, falling back to GPT:", e);
    }
  }

  if (!openai)
    throw new Error(
      "OPENAI_API_KEY not set (and no PaddleOCR API or AI Studio configured)"
    );

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT_IMAGE },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Parse this receipt image and extract all line items, tax, tip, and total.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: ParsedReceipt;
  try {
    parsed = JSON.parse(raw) as ParsedReceipt;
  } catch (e) {
    throw new Error(`[receipt-ocr] Malformed AI response when parsing receipt image: ${e instanceof Error ? e.message : String(e)}`);
  }
  return await cleanReceiptWithLLM(parsed);
}
