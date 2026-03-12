import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";

type LinkEventBody = {
  type?: string;
  source?: string;
  context?: string;
  error?: unknown;
  metadata?: unknown;
  debug?: unknown;
};

/**
 * Lightweight diagnostics endpoint for Plaid Link events.
 * This keeps high-signal failure context in server logs so web/sim/phone
 * differences can be debugged quickly.
 */
export async function POST(request: NextRequest) {
  let body: LinkEventBody | null = null;
  try {
    body = (await request.json()) as LinkEventBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const userId = await getEffectiveUserId();
  const payload = {
    ts: new Date().toISOString(),
    type: body?.type ?? "unknown",
    source: body?.source ?? "unknown",
    context: body?.context ?? "connect",
    userId: userId ?? null,
    ua: request.headers.get("user-agent") ?? "",
    referer: request.headers.get("referer") ?? "",
    error: body?.error ?? null,
    metadata: body?.metadata ?? null,
    debug: body?.debug ?? null,
  };

  // Emit structured logs for quick grep/search in platform logs.
  console.error("[plaid-link-event]", JSON.stringify(payload));

  return NextResponse.json({ ok: true });
}
