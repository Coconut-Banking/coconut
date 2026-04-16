import { google } from "googleapis";
import { clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";
import { encryptToken, decryptToken } from "./encryption";
import { createOAuthState } from "./paypal-auth";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    (process.env.APP_URL ? `${process.env.APP_URL}/api/gmail/callback` : null);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI (or APP_URL) must be set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(clerkUserId: string, mobileRedirect?: string): string {
  const client = getOAuth2Client();
  // Use HMAC-signed state to prevent userId forgery (BUG-AUTH-1).
  // If a mobile deep-link redirect is present, append it after a pipe separator so
  // it travels with the signed state without affecting the HMAC-protected payload.
  const signedState = createOAuthState(clerkUserId);
  const state = mobileRedirect
    ? `${signedState}|${Buffer.from(mobileRedirect).toString("base64url")}`
    : signedState;
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function saveGmailTokens(
  clerkUserId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null },
  email?: string
) {
  console.log("[saveGmailTokens] Saving tokens for user:", clerkUserId, "email:", email);

  const db = getSupabase();
  const { data, error } = await db.from("gmail_connections").upsert(
    {
      clerk_user_id: clerkUserId,
      access_token: tokens.access_token ? encryptToken(tokens.access_token) : "",
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : "",
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      email: email ?? null,
      email_scan_enabled: true,
    },
    { onConflict: "clerk_user_id" }
  ).select().single();

  if (error) {
    console.error("[saveGmailTokens] Failed to save:", error);
    throw error;
  }

  console.log("[saveGmailTokens] Successfully saved:", data);
}

/**
 * Get a Gmail client using the Google OAuth token stored in Clerk.
 * Returns null if the user has no Google external account or the token lacks Gmail scopes.
 * Validates with a lightweight getProfile call to catch scope mismatches early.
 */
async function getGmailClientViaClerk(clerkUserId: string) {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(clerkUserId, "oauth_google");
    const tokenData = tokens.data?.[0];
    if (!tokenData?.token) return null;

    const scopes = (tokenData as { scopes?: string[] }).scopes ?? [];
    if (scopes.length > 0 && !scopes.some((s) => s.includes("gmail"))) {
      return null;
    }

    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: tokenData.token });
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    await gmail.users.getProfile({ userId: "me" });
    return gmail;
  } catch (e) {
    const status = (e as { code?: number }).code ?? (e as { status?: number }).status;
    if (status === 403 || status === 401) {
      if (__DEV__) console.log("[getGmailClientViaClerk] token lacks Gmail scope, falling back");
      return null;
    }
    if (__DEV__) console.warn("[getGmailClientViaClerk] failed:", e);
    return null;
  }
}

const __DEV__ = process.env.NODE_ENV !== "production";

/**
 * Get a Gmail API client for the given user.
 * Tries Clerk's stored Google OAuth token first (2-in-1 flow),
 * then falls back to legacy tokens in gmail_connections.
 */
export async function getGmailClient(clerkUserId: string) {
  const viaClerk = await getGmailClientViaClerk(clerkUserId);
  if (viaClerk) return viaClerk;

  const db = getSupabase();
  const { data, error } = await db
    .from("gmail_connections")
    .select("access_token, refresh_token, token_expiry")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (error || !data) return null;
  if (!data.access_token && !data.refresh_token) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: data.access_token ? decryptToken(data.access_token) : undefined,
    refresh_token: data.refresh_token ? decryptToken(data.refresh_token) : undefined,
    expiry_date: data.token_expiry ? new Date(data.token_expiry).getTime() : undefined,
  });

  client.on("tokens", async (tokens) => {
    const updates: Record<string, string> = {};
    if (tokens.access_token) updates.access_token = encryptToken(tokens.access_token);
    if (tokens.refresh_token) updates.refresh_token = encryptToken(tokens.refresh_token);
    if (tokens.expiry_date) updates.token_expiry = new Date(tokens.expiry_date).toISOString();
    if (Object.keys(updates).length > 0) {
      try {
        await db.from("gmail_connections").update(updates).eq("clerk_user_id", clerkUserId);
      } catch (error) {
        console.error("[getGmailClient] Failed to persist refreshed tokens for user:", clerkUserId, error);
      }
    }
  });

  return google.gmail({ version: "v1", auth: client });
}

/**
 * Check whether the user has a Google OAuth account linked via Clerk
 * (i.e. they signed in with Google and we can use the token for Gmail).
 */
export async function hasClerkGoogleOAuth(clerkUserId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(clerkUserId, "oauth_google");
    return Boolean(tokens.data?.[0]?.token);
  } catch {
    return false;
  }
}

export async function getGmailStatus(clerkUserId: string) {
  const db = getSupabase();
  const { data } = await db
    .from("gmail_connections")
    .select("email, last_scan_at, email_scan_enabled")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const hasGoogleOAuth = await hasClerkGoogleOAuth(clerkUserId);
  const hasLegacyTokens = Boolean(data?.email);

  return {
    connected: hasGoogleOAuth || hasLegacyTokens,
    hasGoogleOAuth,
    email: data?.email ?? null,
    lastScanAt: (data as { last_scan_at?: string | null } | null)?.last_scan_at ?? null,
    emailScanEnabled: (data as { email_scan_enabled?: boolean } | null)?.email_scan_enabled ?? false,
  };
}

export async function removeGmailConnection(clerkUserId: string) {
  const db = getSupabase();
  // Clear email_receipts.transaction_id FK before deleting (prevents FK violation)
  await db.from("email_receipts").update({ transaction_id: null }).eq("clerk_user_id", clerkUserId);
  await db.from("gmail_connections").delete().eq("clerk_user_id", clerkUserId);
  await db.from("email_receipts").delete().eq("clerk_user_id", clerkUserId);
}
