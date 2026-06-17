/**
 * POST /api/cards/migrate-token
 * Called from /connect after a user signs up via the /cards flow.
 * If the user previously connected their bank on /cards (non-Coconut path),
 * their Plaid access token is already stored encrypted in card_tool_sessions.
 * This route migrates it into plaid_items so they don't need to go through
 * Plaid Link again.
 *
 * Returns { ok: true, item_id } on success, or { ok: false } if no migration needed.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadClerkAuth } from "@/lib/auth";
import { getEffectiveUserId } from "@/lib/demo";
import { decryptToken } from "@/lib/encryption";
import {
  savePlaidToken,
  syncTransactionsForUser,
  embedTransactionsForUser,
  embedRichTransactionsForUser,
  enrichCategoriesForUser,
} from "@/lib/transaction-sync";
import { rateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cached-queries";

export async function POST() {
  const session = await loadClerkAuth();
  if (!session.ok) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  const { userId: clerkUserId } = session;
  const effectiveUserId = await getEffectiveUserId({ userId: clerkUserId });
  if (!effectiveUserId) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const rl = rateLimit(`cards-migrate-token:${effectiveUserId}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  // Read the card session cookie
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("card_session_id")?.value;
  if (!sessionId) {
    return NextResponse.json({ ok: false, reason: "no_card_session" });
  }

  const db = getSupabaseAdmin();

  // Load the card tool session — must have a plaid token and must not already be migrated
  const { data: cardSession, error: sessionError } = await db
    .from("card_tool_sessions")
    .select("id, plaid_access_token, plaid_item_id, converted_to_clerk_user_id, expires_at, clerk_user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !cardSession) {
    return NextResponse.json({ ok: false, reason: "session_not_found" });
  }

  const cs = cardSession as {
    id: string;
    plaid_access_token: string | null;
    plaid_item_id: string | null;
    converted_to_clerk_user_id: string | null;
    expires_at: string;
    clerk_user_id: string | null;
  };

  // Nothing to migrate — session has no Plaid token (manual-entry or coconut path)
  if (!cs.plaid_access_token || !cs.plaid_item_id) {
    return NextResponse.json({ ok: false, reason: "no_plaid_token" });
  }

  // Already migrated (possibly by a duplicate request)
  if (cs.converted_to_clerk_user_id) {
    return NextResponse.json({ ok: true, item_id: cs.plaid_item_id, already_migrated: true });
  }

  // Session expired
  if (new Date(cs.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, reason: "session_expired" });
  }

  // Ownership check: sessions created by an authenticated Coconut user have
  // clerk_user_id set and must only be migrated by that same user.
  // Sessions created unauthenticated (analyze-plaid) have clerk_user_id = NULL
  // and are intentionally claimable by any user who holds the cookie.
  if (cs.clerk_user_id !== null && cs.clerk_user_id !== effectiveUserId) {
    return NextResponse.json({ ok: false, reason: "session_not_owned" }, { status: 403 });
  }

  // Decrypt the stored token
  let accessToken: string;
  try {
    accessToken = decryptToken(cs.plaid_access_token);
  } catch (e) {
    console.error("[cards/migrate-token] decrypt failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "decrypt_failed" }, { status: 500 });
  }

  // Check for duplicate institution — don't re-add a bank the user already has
  try {
    const { getPlaidClient } = await import("@/lib/plaid-client");
    const client = getPlaidClient();
    if (client) {
      let institutionId: string | null = null;
      let institutionName: string | null = null;
      try {
        const itemResp = await client.itemGet({ access_token: accessToken });
        institutionId = itemResp.data.item.institution_id ?? null;
        institutionName = itemResp.data.item.institution_name ?? null;

        if (institutionId) {
          const { data: existing } = await db
            .from("plaid_items")
            .select("id, plaid_item_id")
            .eq("clerk_user_id", effectiveUserId)
            .eq("institution_id", institutionId)
            .limit(1)
            .maybeSingle();
          if (existing) {
            // Already connected — mark as converted so we don't try again
            await db
              .from("card_tool_sessions")
              .update({ converted_to_clerk_user_id: effectiveUserId })
              .eq("id", sessionId);
            return NextResponse.json({ ok: true, item_id: cs.plaid_item_id, already_linked: true });
          }
        }

        // Save the token — institution info fetched above
        await savePlaidToken(effectiveUserId, accessToken, cs.plaid_item_id, institutionName, institutionId);
      } catch (itemGetErr) {
        console.warn("[cards/migrate-token] itemGet failed, saving without institution info:", itemGetErr instanceof Error ? itemGetErr.message : itemGetErr);
        await savePlaidToken(effectiveUserId, accessToken, cs.plaid_item_id, null, null);
      }
    } else {
      await savePlaidToken(effectiveUserId, accessToken, cs.plaid_item_id, null, null);
    }
  } catch (e) {
    console.error("[cards/migrate-token] savePlaidToken failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 500 });
  }

  // Mark session as converted
  await db
    .from("card_tool_sessions")
    .update({ converted_to_clerk_user_id: effectiveUserId })
    .eq("id", sessionId);

  // Fire background sync — identical to exchange-token route
  syncTransactionsForUser(effectiveUserId, { requestPlaidRefresh: true, forceRefresh: true })
    .then((result) => {
      if (result.synced > 0) {
        revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");
      }
    })
    .catch((e) =>
      console.error("[cards/migrate-token] background_sync_failed:", e instanceof Error ? e.message : e)
    );

  revalidateTag(CACHE_TAGS.transactions(effectiveUserId), "max");

  embedTransactionsForUser(effectiveUserId).catch((e) =>
    console.error("[cards/migrate-token] background_embed_failed:", e instanceof Error ? e.message : e)
  );
  embedRichTransactionsForUser(effectiveUserId).catch((e) =>
    console.error("[cards/migrate-token] background_rich_embed_failed:", e instanceof Error ? e.message : e)
  );
  enrichCategoriesForUser(effectiveUserId).catch((e) =>
    console.error("[cards/migrate-token] background_categorize_failed:", e instanceof Error ? e.message : e)
  );

  console.log("[cards/migrate-token] migration_ok", {
    user_id: effectiveUserId,
    item_id: cs.plaid_item_id,
  });

  return NextResponse.json({ ok: true, item_id: cs.plaid_item_id });
}
