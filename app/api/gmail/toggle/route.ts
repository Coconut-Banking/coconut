export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUserId } from "@/lib/demo";
import { getSupabase } from "@/lib/supabase";
import { hasClerkGoogleOAuth } from "@/lib/google-auth";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`gmail-toggle:${userId}`, 30, 60_000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { enabled?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const enabled = body.enabled === true;
  const db = getSupabase();

  if (enabled) {
    const hasGoogle = await hasClerkGoogleOAuth(userId);
    const { data: existing } = await db
      .from("gmail_connections")
      .select("access_token")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    const hasLegacyTokens = Boolean(existing?.access_token);

    if (!hasGoogle && !hasLegacyTokens) {
      return NextResponse.json(
        { error: "No Google account connected. Sign in with Google to enable email receipts." },
        { status: 400 }
      );
    }
  }

  await db.from("gmail_connections").upsert(
    {
      clerk_user_id: userId,
      access_token: "",
      refresh_token: "",
      email_scan_enabled: enabled,
    },
    { onConflict: "clerk_user_id" }
  );

  if (enabled) {
    import("@/lib/receipt-parser")
      .then(({ scanGmailForReceipts }) => scanGmailForReceipts(userId, 90, true, false))
      .then((result) => { if (process.env.NODE_ENV === 'development') console.log("[gmail/toggle] Initial scan:", result); })
      .catch((err) => { if (process.env.NODE_ENV === 'development') console.warn("[gmail/toggle] Initial scan failed (non-blocking):", err); });
  }

  return NextResponse.json({ ok: true, emailScanEnabled: enabled });
}
