import OpenAI from "openai";
import type { Transaction } from "./types";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export function hasOpenAI(): boolean {
  return !!openai;
}

export async function embed(text: string): Promise<number[]> {
  if (!openai) throw new Error("OPENAI_API_KEY not set");
  const { data } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return data[0].embedding;
}

export async function chatWithContext(
  userMessage: string,
  transactions: Transaction[],
  subscriptionsSummary: string
): Promise<string> {
  if (!openai) {
    return "Add OPENAI_API_KEY to your environment to use AI insights. For now, try searching your transactions above.";
  }

  const txContext = transactions.length
    ? transactions
        .slice(0, 30)
        .map(
          (t) =>
            `${t.date} ${t.merchant} $${t.amount.toFixed(2)} (${t.category})`
        )
        .join("\n")
    : "No relevant transactions found.";

  const systemPrompt = `You are a helpful personal finance assistant for Coconut, an app like Rocket Money but with AI. You help users understand their spending and subscriptions in plain language. Be concise and friendly. Use the user's transaction and subscription data below to answer. If the data doesn't contain enough info, say so and suggest what to look for.`;

  const content = `Subscription summary:\n${subscriptionsSummary}\n\nRelevant transactions:\n${txContext}\n\nUser question: ${userMessage}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    max_tokens: 500,
  });

  return completion.choices[0]?.message?.content ?? "I couldn't generate a response.";
}
