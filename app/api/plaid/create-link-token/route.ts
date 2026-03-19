export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid-client";
import { getPlaidConfig } from "@/lib/plaid";
import { Products, CountryCode } from "plaid";
import { getEffectiveUserId } from "@/lib/demo";
import { SYNC } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

type CreateLinkBody = { trace_id?: string; update?: boolean; new_accounts?: boolean; access_token?: string };

function getTraceId(maybeTraceId: unknown): string {
  if (typeof maybeTraceId === "string" && maybeTraceId.trim()) return maybeTraceId.trim();
  return `plaid_srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  let body: CreateLinkBody = {};
  try {
    body = (await request.json()) as CreateLinkBody;
  } catch {
    // Allow callers with an empty body.
  }
  const traceId = getTraceId(body.trace_id);
  const effectiveUserId = await getEffectiveUserId();
  console.log("[plaid][create-link-token] request_start", {
    trace_id: traceId,
    has_user: Boolean(effectiveUserId),
    app_url: process.env.APP_URL || null,
    vercel_url: process.env.VERCEL_URL || null,
  });
  if (!effectiveUserId) {
    console.warn("[plaid][create-link-token] unauthorized", { trace_id: traceId });
    return NextResponse.json({ error: "Sign in to connect your bank", trace_id: traceId }, { status: 401 });
  }

  const rl = rateLimit(`plaid-link:${effectiveUserId}`, 30, 60_000);
  if (!rl.success) {
    console.warn("[plaid][create-link-token] rate_limited", { trace_id: traceId, user_id: effectiveUserId });
    return NextResponse.json({ error: "Too many requests", trace_id: traceId }, { status: 429 });
  }

  const client = getPlaidClient();
  const { isConfigured, env } = getPlaidConfig();
  if (!client || !isConfigured) {
    console.error("[plaid][create-link-token] plaid_not_configured", { trace_id: traceId, env });
    return NextResponse.json(
      {
        error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET in .env.local.",
        trace_id: traceId,
      },
      { status: 503 }
    );
  }

  // Use redirect flow for OAuth banks (Chase, etc.) — fixes mobile "stuck" when popup fails
  let baseUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }
  const base = baseUrl.replace(/\/$/, "");
  const redirectUri = `${base}/connect`;
  const webhookUrl = `${base}/api/plaid/webhook`;
  const debug = {
    redirect_uri: redirectUri,
    app_url: process.env.APP_URL || null,
    vercel_url: process.env.VERCEL_URL || null,
  };

  const isUpdateMode = body.update === true || Boolean(body.access_token);
  const accountSelectionEnabled = body.new_accounts === true;

  try {
    const startedAt = Date.now();
    let accessTokenForUpdate: string | undefined = body.access_token;
    if (isUpdateMode && !accessTokenForUpdate) {
      const { getAllPlaidTokensForUser } = await import("@/lib/transaction-sync");
      const tokens = await getAllPlaidTokensForUser(effectiveUserId);
      accessTokenForUpdate = tokens[0] ?? undefined;
    }
    if (isUpdateMode && !accessTokenForUpdate) {
      return NextResponse.json(
        { error: "No bank connection to update. Connect a bank first.", trace_id: body.trace_id },
        { status: 400 }
      );
    }

    const response = isUpdateMode
      ? await client.linkTokenCreate({
          user: { client_user_id: effectiveUserId },
          client_name: "Coconut",
          country_codes: [CountryCode.Us, CountryCode.Ca],
          language: "en",
          redirect_uri: redirectUri,
          webhook: webhookUrl,
          access_token: accessTokenForUpdate,
          update: accountSelectionEnabled ? { account_selection_enabled: true } : undefined,
        })
      : await client.linkTokenCreate({
          user: { client_user_id: effectiveUserId },
          client_name: "Coconut",
          products: [Products.Transactions],
          country_codes: [CountryCode.Us, CountryCode.Ca],
          language: "en",
          transactions: { days_requested: SYNC.PLAID_HISTORY_DAYS },
          redirect_uri: redirectUri,
          webhook: webhookUrl,
        });
    const plaidRequestId = (response.data as { request_id?: string }).request_id;
    console.log("[plaid][create-link-token] request_ok", {
      trace_id: traceId,
      user_id: effectiveUserId,
      plaid_env: env,
      redirect_uri: redirectUri,
      request_id: plaidRequestId ?? null,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({
      link_token: response.data.link_token,
      plaid_env: env,
      trace_id: traceId,
      ...(process.env.NODE_ENV !== "production" && { _debug: debug }),
    });
  } catch (err: unknown) {
    const responseData =
      err &&
      typeof err === "object" &&
      "response" in err &&
      err.response &&
      typeof err.response === "object" &&
      "data" in err.response
        ? (err.response as { data?: Record<string, unknown> }).data
        : undefined;
    const plaidBody = responseData && typeof responseData === "object" ? responseData : undefined;
    const plaidRequestId =
      typeof plaidBody?.request_id === "string" ? plaidBody.request_id : undefined;
    const errorCode = typeof plaidBody?.error_code === "string" ? plaidBody.error_code : "";
    const displayMessage =
      typeof plaidBody?.display_message === "string" && plaidBody.display_message.trim()
        ? plaidBody.display_message
        : null;
    const errorMessage =
      typeof plaidBody?.error_message === "string" && plaidBody.error_message.trim()
        ? plaidBody.error_message
        : null;

    let userMessage = "Failed to create link token";
    if (errorCode === "INVALID_REDIRECT_URI" || /INVALID_REDIRECT_URI/i.test(String(errorMessage))) {
      userMessage =
        "Bank login redirect isn’t allowed for this app. In Plaid Dashboard → Team → API → Allowed redirect URIs, add exactly: " +
        redirectUri;
    } else if (errorCode === "INVALID_WEBHOOK" || /INVALID_WEBHOOK/i.test(String(errorMessage))) {
      userMessage =
        "Webhook URL isn’t registered in Plaid. In Plaid Dashboard → Team → API → Webhooks, allow this URL: " +
        webhookUrl;
    } else if (displayMessage) {
      userMessage = displayMessage;
    } else if (errorMessage && errorCode) {
      userMessage = `${errorMessage} (${errorCode})`;
    } else if (errorMessage) {
      userMessage = errorMessage;
    }

    console.error("[plaid][create-link-token] request_error", {
      trace_id: traceId,
      error: err instanceof Error ? err.message : String(err),
      error_code: errorCode || null,
      request_id: plaidRequestId ?? null,
    });
    const status =
      errorCode === "INVALID_REDIRECT_URI" || errorCode === "INVALID_WEBHOOK" ? 400 : 500;
    return NextResponse.json(
      {
        error: userMessage,
        trace_id: traceId,
        ...(errorCode && { error_code: errorCode }),
        ...(process.env.NODE_ENV !== "production" && { _debug: debug }),
      },
      { status }
    );
  }
}
