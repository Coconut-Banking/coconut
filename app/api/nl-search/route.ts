import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { q, transactions } = body as {
    q: string;
    transactions: Array<{ id: string; merchant: string; amount: number; date: string; category: string }>;
  };

  if (!q?.trim() || !Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ ids: [], answer: "" });
  }

  if (!openai) {
    return NextResponse.json({ ids: transactions.map((t) => t.id), answer: "" });
  }

  const txList = transactions
    .slice(0, 100)
    .map((t) => `${t.id} | ${t.merchant} | $${Math.abs(t.amount).toFixed(2)} | ${t.date} | ${t.category}`)
    .join("\n");

  const prompt = `You answer questions about bank transactions. Return a JSON object with:
- "ids": array of transaction IDs that match (in relevant order)
- "answer": a short, natural-language response that answers the question directly

Transactions (id | merchant | amount | date | category):
${txList}

User asked: "${q.trim()}"

Rules for ids (STRICT - return only what they asked for):
- "the most expensive one" / "biggest" / "largest" = exactly 1 ID, the single highest-amount match.
- "the least expensive" / "cheapest" / "smallest" = exactly 1 ID, the single lowest-amount match.
- "ever" or "of all time" with "cheapest/most expensive" = still just 1 ID.
- "top 5" / "first 3" = that many IDs.
- "all uber" / "every uber" / "show me all" = all matching IDs.
- When in doubt, fewer is better. "Least expensive uber" = 1 ID, not 5.
- No matches = ids: [].

Rules for answer (2-3 sentences max, conversational):
- "Did I spend money on X?" + no matches → "No, there's nothing you spent on [X] in the past [period]."
- "Did I spend money on X?" + matches → "Yes, you spent $X total on [X]. Here are the transactions:"
- "Most expensive uber?" → "Your most expensive Uber was $X on [date]."
- "Least expensive uber?" → "Your cheapest Uber was $X on [date]."
- When showing transactions, briefly summarize (e.g. "You had 3 Uber rides last month totaling $18.") then the list will show them.
- Be direct and helpful. Use actual amounts and dates from the data.

Example: "least expensive uber ever" with 5 Uber transactions ($5.40, $5.40, $6.33, $6.33, $6.33) → return ids: [the $5.40 one], NOT all 5.

Return ONLY valid JSON: {"ids":["id1","id2"],"answer":"Your response here"}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return NextResponse.json({ ids: [], answer: "" });
    const parsed = JSON.parse(raw) as { ids?: string[]; answer?: string };
    let ids = Array.isArray(parsed?.ids)
      ? (parsed.ids as string[]).filter((id) => typeof id === "string")
      : [];
    const qLower = q.toLowerCase();
    const wantsOne = /\b(one|single|the most|the least|cheapest|most expensive|biggest|smallest|ever)\b/.test(qLower) &&
      !/\b(all|every|top \d|first \d)\b/.test(qLower);
    if (wantsOne && ids.length > 1) {
      const txById = new Map(transactions.map((t) => [t.id, t]));
      const matched = ids.map((id) => txById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
      const asc = /\b(least|cheapest|smallest)\b/.test(qLower);
      matched.sort((a, b) => {
        const amtA = Math.abs(a.amount);
        const amtB = Math.abs(b.amount);
        return asc ? amtA - amtB : amtB - amtA;
      });
      ids = matched.length > 0 ? [matched[0].id] : [];
    }
    const answer = typeof parsed?.answer === "string" ? parsed.answer.trim() : "";
    console.log("[nl-search] query:", q.slice(0, 50), "->", ids.length, "ids");
    return NextResponse.json({ ids, answer });
  } catch (err) {
    console.warn("[nl-search] error:", err);
    return NextResponse.json({ ids: [], answer: "" });
  }
}
