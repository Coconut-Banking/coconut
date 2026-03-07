import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const paddleOcrUrl = process.env.PADDLEOCR_API_URL?.replace(/\/$/, "");
const paddleAistudioToken = process.env.PADDLEOCR_AI_STUDIO_TOKEN;
const paddleAistudioUrl =
  process.env.PADDLEOCR_AI_STUDIO_URL?.replace(/\/$/, "") ||
  "https://b3xbb1f6zar0x9me.aistudio-app.com/layout-parsing";

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
- For item names, use the exact text from the receipt.`;

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
  total: number;
}

const SYSTEM_PROMPT_TEXT = `${SYSTEM_PROMPT_IMAGE}

You are given the OCR-extracted text/markdown from a receipt image. Parse it into the JSON structure above.`;

/** Call PaddleOCR AI Studio layout-parsing API; returns markdown text or null. */
async function paddleAistudioOcr(
  imageBase64: string,
  fileType: 0 | 1
): Promise<string | null> {
  if (!paddleAistudioToken) return null;
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
  return JSON.parse(raw) as ParsedReceipt;
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
        return await parseReceiptFromText(text);
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
        const data = await res.json();
        return data as ParsedReceipt;
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
  return JSON.parse(raw) as ParsedReceipt;
}
