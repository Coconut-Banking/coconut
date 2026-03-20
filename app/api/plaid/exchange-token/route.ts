export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getPlaidClient } from "@/lib/plaid-client";
import { savePlaidToken, syncTransactionsForUser, embedTransactionsForUser, embedRichTransactionsForUser, enrichCategoriesForUser } from "@/lib/transaction-sync";
import { getEffectiveUserId } from "@/lib/demo";
import { CACHE_TAGS } from "@/lib/cached-queries";
import { rateLimit } from "@/lib/rate-limit";

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

  const rl = rateLimit(`plaid-exchange:${effectiveUserId}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests", trace_id: traceId }, { status: 429 });
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
    const { access_token, item_id, request_id: plaid_request_id } = response.data;
    if (!access_token || !item_id) {
      console.error("[plaid][exchange-token] exchange returned null credentials", { trace_id: traceId, response: response.data });
      return NextResponse.json({ error: "Failed to exchange token. Please try connecting again.", trace_id: traceId }, { status: 500 });
    }
    console.log("[plaid][exchange-token] exchange_ok", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
      request_id: plaid_request_id ?? null,
      elapsed_ms: Date.now() - startedAt,
    });

    // Get institution_id for duplicate check and display
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const itemResp = await client.itemGet({ access_token: access_token });
      institutionId = itemResp.data.item.institution_id ?? null;
      institutionName = itemResp.data.item.institution_name ?? null;
    } catch (e) {
      console.warn("[plaid][exchange-token] itemGet failed (continuing):", e instanceof Error ? e.message : e);
    }

    // Duplicate institution check — block to avoid extra billing and confusion
    if (institutionId) {
      try {
        const { getSupabase } = await import("@/lib/supabase");
        const db = getSupabase();
        const { data: existing } = await db
          .from("plaid_items")
          .select("id")
          .eq("clerk_user_id", effectiveUserId)
          .eq("institution_id", institutionId)
          .limit(1)
          .maybeSingle();
        if (existing) {
          try {
            await client.itemRemove({ access_token: access_token });
          } catch (e) {
            console.warn("[plaid][exchange-token] itemRemove after duplicate:", e instanceof Error ? e.message : e);
          }
          return NextResponse.json(
            {
              error: "You already have this bank linked. Use Settings → Fix connection if you need to re-authenticate.",
              code: "DUPLICATE_INSTITUTION",
              trace_id: traceId,
            },
            { status: 409 }
          );
        }
      } catch (e) {
        // institution_id column may not exist yet; skip check
        if (!/column.*institution_id|does not exist/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }

    // Only clear existing transactions when this is the user's FIRST connection (avoids
    // wiping other banks when adding a second account). Multi-bank: each item is separate.
    const { getSupabase } = await import("@/lib/supabase");
    const db = getSupabase();
    const { data: existingItems } = await db
      .from("plaid_items")
      .select("id")
      .eq("clerk_user_id", effectiveUserId);
    const isFirstConnection = !existingItems || existingItems.length === 0;

    await savePlaidToken(effectiveUserId, access_token, item_id, institutionName, institutionId);
    console.log("[plaid][exchange-token] token_saved", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
      is_first_connection: isFirstConnection,
    });

    // Only clear on first connection (sandbox→prod) so we don't wipe other banks
    if (process.env.NODE_ENV === "production" && isFirstConnection) {
      const { data: toDelete } = await db
        .from("transactions")
        .select("id, plaid_transaction_id")
        .eq("clerk_user_id", effectiveUserId);
      const userTxIds = (toDelete ?? []).map((r) => r.id as string);

      // Protect bank transactions that are referenced by split_transactions or subscription_transactions
      // (scoped to current user's transactions only)
      const { data: inSplits } = await db
        .from("split_transactions")
        .select("transaction_id")
        .in("transaction_id", userTxIds);
      const { data: inSubscriptions } = await db
        .from("subscription_transactions")
        .select("transaction_id")
        .in("transaction_id", userTxIds);
      const protectedIds = new Set([
        ...(inSplits ?? []).map((r) => r.transaction_id as string),
        ...(inSubscriptions ?? []).map((r) => r.transaction_id as string),
      ].filter(Boolean));
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

    // Invalidate cached transactions so the user sees fresh data immediately
    revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");

    embedTransactionsForUser(effectiveUserId).catch((e) =>
      console.error("[plaid][exchange-token] background_embed_failed", {
        trace_id: traceId,
        user_id: effectiveUserId,
        error: e instanceof Error ? e.message : String(e),
      })
    );
    embedRichTransactionsForUser(effectiveUserId).catch((e) =>
      console.error("[plaid][exchange-token] background_rich_embed_failed", {
        trace_id: traceId,
        user_id: effectiveUserId,
        error: e instanceof Error ? e.message : String(e),
      })
    );
    enrichCategoriesForUser(effectiveUserId).catch((e) =>
      console.error("[plaid][exchange-token] background_categorize_failed", {
        trace_id: traceId,
        user_id: effectiveUserId,
        error: e instanceof Error ? e.message : String(e),
      })
    );

    console.log("[plaid][exchange-token] request_ok", {
      trace_id: traceId,
      user_id: effectiveUserId,
      item_id,
      request_id: plaid_request_id ?? null,
      synced,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, item_id, synced, trace_id: traceId });
  } catch (err) {
    const errObj = err && typeof err === "object" ? err : {};
    const response = "response" in errObj ? (errObj.response as { data?: unknown; status?: number }) : null;
    const data = response?.data;
    const plaidData = data && typeof data === "object" ? (data as { error_code?: string; error_type?: string; display_message?: string | null; error_message?: string }) : null;
    let errorCode = plaidData?.error_code;
    const displayMessage = plaidData?.display_message?.trim() || plaidData?.error_message;
    let plaidRequestId = plaidData && "request_id" in plaidData ? (plaidData as { request_id?: string }).request_id : undefined;

    const innerMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    // Supabase / PostgREST errors (savePlaidToken, etc.) — no Plaid response body
    const pg =
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
        ? (err as { code?: string; message: string; details?: string; hint?: string })
        : null;
    const looksLikeDb =
      pg &&
      (pg.code === "PGRST116" ||
        /row-level security|violates foreign key|duplicate key|unique constraint|plaid_items/i.test(
          `${pg.message} ${pg.details ?? ""}`
        ));

    // Map Plaid/known errors to user-friendly messages
    let message: string;
    let statusCode = 500;
    if (errorCode === "INSTITUTION_NO_LONGER_SUPPORTED" || errorCode === "INSTITUTION_NOT_AVAILABLE" || errorCode === "UNSUPPORTED_RESPONSE") {
      message = "This bank isn't supported yet. Please try another bank.";
      statusCode = 400;
    } else if (errorCode === "INSTITUTION_DOWN" || errorCode === "INSTITUTION_NOT_RESPONDING") {
      message = "The bank is temporarily unavailable. Try again in a few hours, or connect a different bank.";
      statusCode = 503;
    } else if (
      errorCode === "INVALID_PUBLIC_TOKEN" ||
      errorCode === "INVALID_INPUT" ||
      /invalid.*public.?token|already been used|expired/i.test(displayMessage ?? innerMessage)
    ) {
      message =
        "This bank session expired or was already used. Please close the window and connect your bank again from the start.";
      statusCode = 400;
    } else if (displayMessage) {
      message = displayMessage;
      statusCode = response?.status && response.status >= 400 && response.status < 600 ? response.status : 500;
    } else if (innerMessage.includes("TOKEN_ENCRYPTION_KEY")) {
      message =
        "Bank linking isn’t available right now because of a server configuration issue. Please try again later.";
      statusCode = 503;
      errorCode = errorCode ?? "TOKEN_ENCRYPTION_KEY_INVALID";
    } else if (looksLikeDb) {
      message =
        "We couldn't save your bank connection. Please try again in a moment. If it keeps failing, contact support with your trace ID.";
      statusCode = 503;
      errorCode = errorCode ?? "DATABASE_ERROR";
    } else if (innerMessage && /Network Error|ECONNRESET|ETIMEDOUT|timeout/i.test(innerMessage)) {
      message = "Connection to our bank partner timed out. Please try again.";
      statusCode = 503;
    } else if (innerMessage) {
      // Don't tell users to "try another bank" for unknown infra errors
      message = "We couldn't finish linking your bank. Please try again. If the problem continues, try a different browser or contact support.";
      statusCode = 500;
    } else {
      message = "We couldn't finish linking your bank. Please try again.";
      statusCode = 500;
    }

    console.error("[plaid][exchange-token] request_error", {
      trace_id: traceId,
      user_id: effectiveUserId,
      error: message,
      error_code: errorCode ?? null,
      request_id: plaidRequestId ?? null,
      inner_message: innerMessage || null,
      http_status: response?.status ?? null,
      supabase_code: pg?.code ?? null,
      supabase_message: pg?.message?.slice(0, 500) ?? null,
      owner_fix_hint: innerMessage.includes("TOKEN_ENCRYPTION_KEY")
        ? "Set TOKEN_ENCRYPTION_KEY in Vercel to 64 hex chars from `openssl rand -hex 32` (see .env.example)"
        : null,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message, code: errorCode ?? undefined, trace_id: traceId }, { status: statusCode });
  }
}
