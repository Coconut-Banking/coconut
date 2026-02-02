import { NextRequest, NextResponse } from "next/server";
import { searchTransactions } from "@/lib/search";
import { getSubscriptions } from "@/lib/data";
import { chatWithContext } from "@/lib/openai";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = (body.message as string)?.trim();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const subscriptions = getSubscriptions();
    const subsSummary = subscriptions
      .map((s) => `${s.name}: $${s.amount}/${s.frequency}`)
      .join(", ");

    const relevantTx = searchTransactions(message, 30);
    const reply = await chatWithContext(message, relevantTx, subsSummary);

    return NextResponse.json({ reply });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chat failed" },
      { status: 500 }
    );
  }
}
