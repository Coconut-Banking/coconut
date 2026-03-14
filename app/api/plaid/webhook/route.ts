import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import * as jose from "jose";
import { getPlaidClient } from "@/lib/plaid-client";
import { getSupabase } from "@/lib/supabase";
import { syncTransactionsForUser, embedTransactionsForUser } from "@/lib/transaction-sync";

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
      const resp = await client.webhookVerificationKeyGet({ key_id: kid });
      cachedVerificationKey = resp.data.key as jose.JWK;
    }

    const key = await jose.importJWK(cachedVerificationKey, "ES256");
    const { payload } = await jose.jwtVerify(verificationHeader, key, { maxTokenAge: "5 min" });

    const claimedHash = (payload as { request_body_sha256?: string }).request_body_sha256;
    if (!claimedHash) return false;

    const bodyHash = createHash("sha256").update(body).digest("hex");
    if (bodyHash.length !== claimedHash.length) return false;
    return timingSafeEqual(Buffer.from(bodyHash, "hex"), Buffer.from(claimedHash, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json({ ok: true }); // Plaid not configured; ack to stop retries
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const verificationHeader = request.headers.get("plaid-verification");
  if (verificationHeader) {
    const ok = await verifyPlaidWebhook(body, verificationHeader);
    if (!ok) {
      console.warn("[plaid][webhook] verification failed");
      return NextResponse.json({ error: "Verification failed" }, { status: 401 });
    }
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

  if (webhook_type === "TRANSACTIONS" && webhook_code === "SYNC_UPDATES_AVAILABLE") {
    syncTransactionsForUser(clerkUserId)
      .then((r) => {
        console.log("[plaid][webhook] SYNC_UPDATES_AVAILABLE synced", {
          item_id,
          user_id: clerkUserId,
          synced: r.synced,
        });
        embedTransactionsForUser(clerkUserId).catch((e) =>
          console.warn("[plaid][webhook] embed failed:", e instanceof Error ? e.message : e)
        );
      })
      .catch((e) =>
        console.error("[plaid][webhook] sync failed:", e instanceof Error ? e.message : e)
      );
  } else if (webhook_type === "ITEM") {
    if (webhook_code === "NEW_ACCOUNTS_AVAILABLE") {
      db.from("plaid_items").update({ new_accounts_available: true }).eq("plaid_item_id", item_id).then(() => {}, () => {});
      syncTransactionsForUser(clerkUserId)
        .then((r) => {
          console.log("[plaid][webhook] NEW_ACCOUNTS_AVAILABLE synced", {
            item_id,
            user_id: clerkUserId,
            synced: r.synced,
          });
          embedTransactionsForUser(clerkUserId).catch((e) =>
            console.warn("[plaid][webhook] embed failed:", e instanceof Error ? e.message : e)
          );
        })
        .catch((e) =>
          console.error("[plaid][webhook] sync failed:", e instanceof Error ? e.message : e)
        );
    } else if (webhook_code === "ERROR" && payload.error?.error_code === "ITEM_LOGIN_REQUIRED") {
      console.log("[plaid][webhook] ITEM_LOGIN_REQUIRED", { item_id, user_id: clerkUserId });
      db.from("plaid_items").update({ needs_reauth: true }).eq("plaid_item_id", item_id).then(() => {}, () => {});
    } else if (webhook_code === "PENDING_EXPIRATION" || webhook_code === "PENDING_DISCONNECT") {
      console.log("[plaid][webhook] expiration/disconnect", { webhook_code, item_id, user_id: clerkUserId });
      db.from("plaid_items").update({ needs_reauth: true }).eq("plaid_item_id", item_id).then(() => {}, () => {});
    } else if (webhook_code === "LOGIN_REPAIRED") {
      console.log("[plaid][webhook] LOGIN_REPAIRED", { item_id, user_id: clerkUserId });
      db.from("plaid_items").update({ needs_reauth: false }).eq("plaid_item_id", item_id).then(() => {}, () => {});
      syncTransactionsForUser(clerkUserId).catch((e) =>
        console.warn("[plaid][webhook] post-repair sync failed:", e instanceof Error ? e.message : e)
      );
    } else if (
      webhook_code === "USER_PERMISSION_REVOKED" ||
      webhook_code === "USER_ACCOUNT_REVOKED"
    ) {
      console.log("[plaid][webhook] user revoked", { webhook_code, item_id, user_id: clerkUserId });
    }
  }

  return NextResponse.json({ ok: true });
}
