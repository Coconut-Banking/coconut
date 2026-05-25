import OpenAI from "openai";
import type { ParsedReceipt } from "./receipt-ocr";
import { NotAReceiptError } from "./receipt-errors";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const CLASSIFY_PROMPT = `You classify uploaded images/documents for a receipt-splitting app.

Return JSON only:
{
  "is_receipt": boolean,
  "document_type": "receipt" | "e_receipt" | "invoice" | "photo" | "screenshot" | "menu" | "bank_statement" | "id_card" | "other",
  "confidence": "high" | "medium" | "low",
  "user_message": "One short friendly sentence for the user"
}

Set is_receipt true ONLY when the image is clearly:
- A paper/store/restaurant receipt photo, OR
- A digital purchase receipt / e-receipt / order confirmation with line items and a total (email screenshot, PDF receipt, etc.)

Set is_receipt false for:
- Random photos (people, pets, scenery, selfies, food plates without a receipt)
- Product packaging, price tags, menus without a completed purchase
- Bank/credit card statements, transaction lists without itemized receipt layout
- Blank, blurry, or unreadable images
- IDs, tickets, flyers, memes, chat screenshots unrelated to a purchase

user_message examples when false:
- "This looks like a regular photo — try a clear picture of your receipt."
- "We couldn't find receipt details in this image."

Be strict: if unsure, set is_receipt false and confidence low.`;

export type ReceiptClassification = {
  is_receipt: boolean;
  document_type: string;
  confidence: string;
  user_message: string;
};

function parseClassification(raw: unknown): ReceiptClassification {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const is_receipt = obj.is_receipt === true;
  const document_type =
    typeof obj.document_type === "string" ? obj.document_type : "other";
  const confidence =
    typeof obj.confidence === "string" ? obj.confidence : "low";
  const user_message =
    typeof obj.user_message === "string" && obj.user_message.trim()
      ? obj.user_message.trim()
      : is_receipt
        ? ""
        : "We couldn't find a receipt in this image. Try a clear photo of your receipt or e-receipt.";
  return { is_receipt, document_type, confidence, user_message };
}

/** Vision check before full OCR (gpt-4o-mini). */
export async function classifyReceiptImage(
  imageBase64: string,
  mimeType: string
): Promise<ReceiptClassification> {
  if (!openai) {
    return {
      is_receipt: true,
      document_type: "receipt",
      confidence: "low",
      user_message: "",
    };
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Is this a receipt or e-receipt suitable for expense splitting?",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: "low",
            },
          },
        ],
      },
    ],
    max_tokens: 200,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    return parseClassification(JSON.parse(raw));
  } catch {
    return {
      is_receipt: true,
      document_type: "receipt",
      confidence: "low",
      user_message: "",
    };
  }
}

export function assertIsReceiptClassification(
  classification: ReceiptClassification
): void {
  if (classification.is_receipt) return;
  throw new NotAReceiptError(
    classification.user_message,
    classification.document_type
  );
}

/** Backstop when the parser returns an empty shell. */
export function assertParsedReceiptHasContent(parsed: ParsedReceipt): void {
  const merchant = (parsed.merchant_name ?? "").trim().toLowerCase();
  const unknownMerchant = !merchant || merchant === "unknown";
  const noItems = !Array.isArray(parsed.items) || parsed.items.length === 0;
  const noTotal = !(parsed.total > 0);
  if (unknownMerchant && noItems && noTotal) {
    throw new NotAReceiptError(
      "We couldn't read any items or totals from this image. Please upload a clear receipt or e-receipt.",
      "other"
    );
  }
}
