import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import * as jose from "jose";
import { getPlaidClient } from "@/lib/plaid-client";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { syncTransactionsForUser } from "@/lib/transaction-sync";

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string };
};

let cachedVerificationKey: jose.JWK | null = null;

async function verifyPlaidWebhook(body: string, verificationHeader: string | null): Promise<boolean> {
  if (!verificationHeader) return false;
  const client = getPlaidClient();
  if (!client) return false;

  try {
    const decoded = jose.decodeProtectedHeader(verificationHeader);
    if (decoded.alg !== "ES256") return false;
    const kid = decoded.kid;
    if (!kid) return false;

    if (!cachedVerificationKey || cachedVerificationKey.kid !== kid) {
      try {
        const resp = await client.webhookVerificationKeyGet({ key_id: kid });
        const fetchedKey = resp.data.key as jose.JWK;
        if (!fetchedKey || !fetchedKey.kty || !fetchedKey.kid) {
          console.error("[plaid][webhook] webhookVerificationKeyGet returned invalid key", { kid });
          return false;
        }
        cachedVerificationKey = fetchedKey;
      } catch (fetchErr) {
        console.error(
          "[plaid][webhook] webhookVerificationKeyGet failed:",
          fetchErr instanceof Error ? fetchErr.message : fetchErr
        );
        // Transient Plaid API failure: fall back to cached key if kid matches,
        // otherwise we have no key to verify with — reject.
        if (!cachedVerificationKey || cachedVerificationKey.kid !== kid) return false;
        // cachedVerificationKey.kid === kid: use it as fallback
      }
    }

    const key = await jose.importJWK(cachedVerificationKey!, "ES256");
    const { payload } = await jose.jwtVerify(verificationHeader, key, { maxTokenAge: "5 min" });

    const claimedHash = (payload as { request_body_sha256?: string }).request_body_sha256;
    if (!claimedHash) return false;

    const bodyHash = createHash("sha256").update(body).digest("hex");
    const normalizedClaimed = claimedHash.toLowerCase();
    const bodyBuf = Buffer.from(bodyHash, "hex");
    const claimedBuf = Buffer.from(normalizedClaimed, "hex");
    if (bodyBuf.length !== claimedBuf.length) return false;
    return timingSafeEqual(bodyBuf, claimedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const client = getPlaidClient();
  if (!client) {
    console.error("[plaid][webhook] Plaid client not configured — returning 503 for retry");
    return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const verificationHeader = request.headers.get("plaid-verification");
  if (!verificationHeader) {
    console.warn("[plaid][webhook] missing verification header");
    return NextResponse.json({ error: "Missing verification" }, { status: 401 });
  }
  const ok = await verifyPlaidWebhook(body, verificationHeader);
  if (!ok) {
    console.warn("[plaid][webhook] verification failed");
    return NextResponse.json({ error: "Verification failed" }, { status: 401 });
  }

  let payload: PlaidWebhookPayload;
  try {
    payload = JSON.parse(body) as PlaidWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { webhook_type, webhook_code, item_id } = payload;

  if (!item_id) {
    return NextResponse.json({ ok: true }); // Acknowledge unknown webhook
  }

  const db = getSupabase();
  const { data: item } = await db
    .from("plaid_items")
    .select("clerk_user_id")
    .eq("plaid_item_id", item_id)
    .maybeSingle();

  if (!item?.clerk_user_id) {
    console.log("[plaid][webhook] item not found", { item_id, webhook_code });
    return NextResponse.json({ ok: true });
  }

  const clerkUserId = item.clerk_user_id as string;

  // Sync API: Plaid sends SYNC_UPDATES_AVAILABLE. Legacy / first-load flows may send
  // INITIAL_UPDATE or HISTORICAL_UPDATE — we must sync on those too or data stays stale until manual refresh.
  const transactionWebhookSyncCodes = new Set([
    "SYNC_UPDATES_AVAILABLE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
  ]);

  if (webhook_type === "TRANSACTIONS" && webhook_code && transactionWebhookSyncCodes.has(webhook_code)) {
    // Deduplicate: skip insert if a pending/processing job already exists for this user.
    // Plaid sends webhook bursts (e.g. DEFAULT_UPDATE + HISTORICAL_UPDATE) — without this
    // guard, the old rateLimit() protection is gone and we'd run 2-5 redundant full syncs.
    const { data: existing } = await db
      .from("job_queue")
      .select("id")
      .eq("type", "plaid_sync")
      .eq("clerk_user_id", clerkUserId)
      .in("status", ["pending", "processing"])
      .limit(1)
      .maybeSingle();

    if (!existing) {
      // Queue background sync instead of running inline — returns 200 to Plaid in ~20ms.
      const { error: queueErr } = await db.from("job_queue").insert({
        type: "plaid_sync",
        payload: { clerk_user_id: clerkUserId, item_id, webhook_code },
        clerk_user_id: clerkUserId,
      });
      if (queueErr) {
        // DB failure: return 503 so Plaid retries the webhook (do NOT return 200)
        console.error("[plaid][webhook] job_queue insert failed:", queueErr.message);
        return NextResponse.json({ error: "Queue unavailable" }, { status: 503 });
      }
      console.log("[plaid][webhook] queued plaid_sync", { webhook_code, item_id, user: clerkUserId });
    } else {
      console.log("[plaid][webhook] deduplicated plaid_sync (already queued)", { webhook_code, user: clerkUserId });
    }
  } else if (webhook_type === "ITEM") {
    if (webhook_code === "NEW_ACCOUNTS_AVAILABLE") {
      const [{ error: newAccountsErr }, { data: existingJob }] = await Promise.all([
        db.from("plaid_items").update({ new_accounts_available: true }).eq("plaid_item_id", item_id),
        db
          .from("job_queue")
          .select("id")
          .eq("type", "plaid_sync")
          .eq("clerk_user_id", clerkUserId)
          .in("status", ["pending", "processing"])
          .limit(1)
          .maybeSingle(),
      ]);
      if (newAccountsErr) {
        console.error("[plaid][webhook] plaid_items update failed (NEW_ACCOUNTS):", newAccountsErr.message);
        return NextResponse.json({ error: "DB update failed" }, { status: 503 });
      }
      if (!existingJob) {
        const { error: queueErr } = await db.from("job_queue").insert({
          type: "plaid_sync",
          payload: { clerk_user_id: clerkUserId, item_id, webhook_code },
          clerk_user_id: clerkUserId,
        });
        if (queueErr) {
          console.error("[plaid][webhook] job_queue insert failed (NEW_ACCOUNTS):", queueErr.message);
          return NextResponse.json({ error: "Queue unavailable" }, { status: 503 });
        }
      }
      console.log("[plaid][webhook] queued plaid_sync for NEW_ACCOUNTS_AVAILABLE", { item_id });
    } else if (webhook_code === "ERROR" && payload.error?.error_code === "ITEM_LOGIN_REQUIRED") {
      console.log("[plaid][webhook] ITEM_LOGIN_REQUIRED", { item_id, user_id: clerkUserId });
      const { error: reauthErr } = await db.from("plaid_items").update({ needs_reauth: true }).eq("plaid_item_id", item_id);
      if (reauthErr) {
        console.error("[plaid][webhook] plaid_items update failed (ITEM_LOGIN_REQUIRED):", reauthErr.message);
        return NextResponse.json({ error: "DB update failed" }, { status: 503 });
      }
    } else if (webhook_code === "PENDING_EXPIRATION" || webhook_code === "PENDING_DISCONNECT") {
      console.log("[plaid][webhook] expiration/disconnect", { webhook_code, item_id, user_id: clerkUserId });
      const { error: pendingErr } = await db.from("plaid_items").update({ needs_reauth: true }).eq("plaid_item_id", item_id);
      if (pendingErr) {
        console.error("[plaid][webhook] plaid_items update failed (PENDING_EXPIRATION/DISCONNECT):", pendingErr.message);
        return NextResponse.json({ error: "DB update failed" }, { status: 503 });
      }
    } else if (webhook_code === "LOGIN_REPAIRED") {
      console.log("[plaid][webhook] LOGIN_REPAIRED", { item_id, user_id: clerkUserId });
      // Queue the post-repair sync (non-critical — reauth flag is already cleared)
      await Promise.all([
        db.from("plaid_items").update({ needs_reauth: false }).eq("plaid_item_id", item_id).then(({ error }) => {
          if (error) console.error("[plaid][webhook] plaid_items update failed (LOGIN_REPAIRED):", error.message);
        }),
        db.from("job_queue").insert({
          type: "plaid_sync",
          payload: { clerk_user_id: clerkUserId, item_id, webhook_code },
          clerk_user_id: clerkUserId,
        }).then(({ error }) => {
          if (error) console.warn("[plaid][webhook] queue insert failed for LOGIN_REPAIRED (non-fatal):", error.message);
        }),
      ]);
    } else if (
      webhook_code === "USER_PERMISSION_REVOKED" ||
      webhook_code === "USER_ACCOUNT_REVOKED"
    ) {
      console.log("[plaid][webhook] user revoked — calling itemRemove", { webhook_code, item_id, user_id: clerkUserId });
      try {
        const { data: itemRow } = await db
          .from("plaid_items")
          .select("access_token")
          .eq("plaid_item_id", item_id)
          .maybeSingle();
        if (itemRow?.access_token) {
          const token = decryptToken(itemRow.access_token as string);
          await client.itemRemove({ access_token: token }).catch((e: unknown) =>
            console.warn("[plaid][webhook] itemRemove for revoked item:", e instanceof Error ? e.message : e)
          );
        }
      } catch (e) {
        console.warn("[plaid][webhook] failed to fetch token for itemRemove:", e instanceof Error ? e.message : e);
      }
      const { error: revokeErr } = await db.from("plaid_items").update({ needs_reauth: true }).eq("plaid_item_id", item_id);
      if (revokeErr) {
        console.error("[plaid][webhook] plaid_items update failed (USER_REVOKED):", revokeErr.message);
        return NextResponse.json({ error: "DB update failed" }, { status: 503 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
