import { NextRequest, NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { savePlaidToken, syncTransactionsForUser, embedTransactionsForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";

type ExchangeTokenBody = {
  public_token?: string;
  trace_id?: string;
};

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function getTraceId(maybeTraceId: unknown): string {
  if (typeof maybeTraceId === "string" && maybeTraceId.trim()) return maybeTraceId.trim();
  return `plaid_srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const effectiveUserId = await getEffectiveUserId();
  let body: ExchangeTokenBody;
  try {
    body = (await request.json()) as ExchangeTokenBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const traceId = getTraceId(body.trace_id);
  console.log("[plaid][exchange-token] request_start", {
    trace_id: traceId,
    has_user: Boolean(effectiveUserId),
    has_public_token: Boolean(body.public_token),
  });
  if (!effectiveUserId) {
    console.warn("[plaid][exchange-token] unauthorized", { trace_id: traceId });
    return NextResponse.json({ error: "Sign in to connect your bank", trace_id: traceId }, { status: 401 });
  }
  const { public_token } = body;
  if (!public_token) {
    return NextResponse.json({ error: "public_token required", trace_id: traceId }, { status: 400 });
  }

  const client = getPlaidClient();
  if (!client) return NextResponse.json({ error: "Plaid is not configured", trace_id: traceId }, { status: 503 });

  try {
    console.log("[plaid][exchange-token] exchanging_public_token", {
      trace_id: traceId,
      user_id: effectiveUserId,
      public_token: maskToken(public_token),
    });
    const response = await client.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;
    console.log("[plaid][exchange-token] exchange_ok", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
      elapsed_ms: Date.now() - startedAt,
    });

    await savePlaidToken(effectiveUserId, access_token, item_id);
    console.log("[plaid][exchange-token] token_saved", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
    });

    // In production, clear stale/sandbox tx first so only real bank data remains
    if (process.env.NODE_ENV === "production") {
      const { getSupabase } = await import("@/lib/supabase");
      const db = getSupabase();
      const { data: inSplits } = await db.from("split_transactions").select("transaction_id");
      const protectedIds = new Set((inSplits ?? []).map((r) => r.transaction_id as string));
      const { data: toDelete } = await db
        .from("transactions")
        .select("id, plaid_transaction_id")
        .eq("clerk_user_id", effectiveUserId);
      const idsToDelete = (toDelete ?? [])
        .filter((r) => !String(r.plaid_transaction_id || "").startsWith("manual_"))
        .map((r) => r.id as string)
        .filter((id) => !protectedIds.has(id));
      if (idsToDelete.length > 0) {
        await db.from("transactions").delete().in("id", idsToDelete);
        console.log("[plaid][exchange-token] cleared_existing_transactions", {
          trace_id: traceId,
          user_id: effectiveUserId,
          count: idsToDelete.length,
        });
      }
    }
    let synced = 0;
    let syncError: string | undefined;
    // Plaid can return 0 immediately after OAuth handoff; retry a couple times.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 3000 * attempt)); // 3s, then 6s
      }
      const result = await syncTransactionsForUser(effectiveUserId);
      synced = result.synced;
      syncError = result.error;
      if (syncError) {
        console.warn("[plaid][exchange-token] sync_warning", {
          trace_id: traceId,
          user_id: effectiveUserId,
          attempt: attempt + 1,
          error: syncError,
        });
      }
      console.log("[plaid][exchange-token] sync_attempt_result", {
        trace_id: traceId,
        user_id: effectiveUserId,
        attempt: attempt + 1,
        synced,
      });
      if (synced > 0) break;
    }

    embedTransactionsForUser(effectiveUserId).catch((e) =>
      console.error("[plaid][exchange-token] background_embed_failed", {
        trace_id: traceId,
        user_id: effectiveUserId,
        error: e instanceof Error ? e.message : String(e),
      })
    );

    console.log("[plaid][exchange-token] request_ok", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
      synced,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, item_id, synced, trace_id: traceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to exchange token";
    console.error("[plaid][exchange-token] request_error", {
      trace_id: traceId,
      user_id: effectiveUserId,
      error: message,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message, trace_id: traceId }, { status: 500 });
  }
}
