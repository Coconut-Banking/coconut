import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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

const SYSTEM_PROMPT = `You are a receipt parser. Given a photo of a receipt, extract structured data as JSON.

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

export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string
): Promise<ParsedReceipt> {
  if (!openai) throw new Error("OPENAI_API_KEY not set");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
