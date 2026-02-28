import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { parseQuery, type QueryFilters } from "@/lib/nl-query";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const TODAY = new Date().toISOString().slice(0, 10);
const LAST_30_START = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You extract search filters from natural language queries about financial transactions.
Today's date is ${TODAY} (YYYY-MM-DD).

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "keywords": ["word1", "word2"],
  "dateStart": "YYYY-MM-DD" or null,
  "dateEnd": "YYYY-MM-DD" or null,
  "amountMin": number or null,
  "amountMax": number or null,
  "categoryHint": "string" or null
}

Rules:
- keywords: CRITICAL - Return terms that ACTUALLY APPEAR in bank transaction data (merchant names, raw descriptions). Expand semantic/conceptual terms into real strings. Examples: "rideshare" -> ["uber","lyft"]; "coffee" -> ["starbucks","coffee","dunkin","peets"]; "streaming" -> ["netflix","spotify","hulu"]; "food"/"dining" -> ["restaurant","grubhub","doordash","chipotle"] or use categoryHint instead. Exclude stop words.
- dateStart/dateEnd: "past month", "last month", "past 30 days" = ${LAST_30_START} to ${TODAY}. "last week" = 7 days back.
- amountMin/amountMax: from "over $50", "under $100", etc.
- categoryHint: Plaid categories - food/dining -> "food and drink", groceries -> "groceries", rideshare/uber/lyft/transport -> "transportation", subscriptions -> "subscriptions", entertainment -> "entertainment", shopping -> "shopping", travel -> "travel"

Examples:
"how much did I spend on rideshare in the last month" -> {"keywords":["uber","lyft"],"dateStart":"${LAST_30_START}","dateEnd":"${TODAY}","amountMin":null,"amountMax":null,"categoryHint":"transportation"}
"how much did I spend on food in the past month" -> {"keywords":[],"dateStart":"${LAST_30_START}","dateEnd":"${TODAY}","amountMin":null,"amountMax":null,"categoryHint":"food and drink"}
"coffee in January" -> {"keywords":["starbucks","coffee","dunkin"],"dateStart":"2026-01-01","dateEnd":"2026-01-31","amountMin":null,"amountMax":null,"categoryHint":"food and drink"}
"subscriptions over $10" -> {"keywords":["netflix","spotify","hulu"],"dateStart":null,"dateEnd":null,"amountMin":10,"amountMax":null,"categoryHint":"subscriptions"}`;

function validateAndSanitize(obj: unknown): QueryFilters {
  if (!obj || typeof obj !== "object") return { keywords: [] };
  const o = obj as Record<string, unknown>;
  const keywords = Array.isArray(o.keywords)
    ? (o.keywords as unknown[]).filter((k) => typeof k === "string").map((k) => (k as string).toLowerCase())
    : [];
  const dateStart = typeof o.dateStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dateStart) ? o.dateStart : undefined;
  const dateEnd = typeof o.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dateEnd) ? o.dateEnd : undefined;
  const amountMin = typeof o.amountMin === "number" && o.amountMin >= 0 ? o.amountMin : undefined;
  const amountMax = typeof o.amountMax === "number" && o.amountMax >= 0 ? o.amountMax : undefined;
  const categoryHint = typeof o.categoryHint === "string" && o.categoryHint ? o.categoryHint.toLowerCase() : undefined;
  return { keywords, dateStart, dateEnd, amountMin, amountMax, categoryHint };
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ filters: { keywords: [] } });
  }

  if (!openai) {
    const filters = parseQuery(q);
    return NextResponse.json({ filters });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: q },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      const filters = parseQuery(q);
      return NextResponse.json({ filters });
    }
    const parsed = JSON.parse(raw) as unknown;
    const filters = validateAndSanitize(parsed);
    console.log("[nl-parse] query:", q, "-> filters:", JSON.stringify(filters));
    return NextResponse.json({ filters });
  } catch (err) {
    console.warn("[nl-parse] OpenAI error, falling back to regex:", err);
    const filters = parseQuery(q);
    return NextResponse.json({ filters });
  }
}
