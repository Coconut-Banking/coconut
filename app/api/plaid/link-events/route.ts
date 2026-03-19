export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";

type LinkEventBody = {
  trace_id?: string;
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
    trace_id: body?.trace_id ?? `plaid_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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
  const level = String(payload.type).includes("error") || String(payload.type).includes("exception")
    ? "error"
    : "log";
  if (level === "error") {
    console.error("[plaid-link-event]", JSON.stringify(payload));
  } else {
    console.log("[plaid-link-event]", JSON.stringify(payload));
  }

  return NextResponse.json({ ok: true, trace_id: payload.trace_id });
}
