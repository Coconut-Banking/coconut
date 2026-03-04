import { google } from "googleapis";
import { getSupabase } from "./supabase";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(clerkUserId: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: clerkUserId,
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
  const db = getSupabase();
  await db.from("gmail_connections").upsert(
    {
      clerk_user_id: clerkUserId,
      access_token: tokens.access_token ?? "",
      refresh_token: tokens.refresh_token ?? "",
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      email: email ?? null,
    },
    { onConflict: "clerk_user_id" }
  );
}

export async function getGmailClient(clerkUserId: string) {
  const db = getSupabase();
  const { data } = await db
    .from("gmail_connections")
    .select("access_token, refresh_token, token_expiry")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!data) return null;

  const client = getOAuth2Client();
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.token_expiry ? new Date(data.token_expiry).getTime() : undefined,
  });

  // Auto-refresh: when tokens refresh, persist them
  client.on("tokens", async (tokens) => {
    const updates: Record<string, string> = {};
    if (tokens.access_token) updates.access_token = tokens.access_token;
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) updates.token_expiry = new Date(tokens.expiry_date).toISOString();
    if (Object.keys(updates).length > 0) {
      await db.from("gmail_connections").update(updates).eq("clerk_user_id", clerkUserId);
    }
  });

  return google.gmail({ version: "v1", auth: client });
}

export async function getGmailStatus(clerkUserId: string) {
  const db = getSupabase();
  const { data } = await db
    .from("gmail_connections")
    .select("email, last_scan_at")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!data) return { connected: false, email: null, lastScan: null };
  return { connected: true, email: data.email, lastScan: data.last_scan_at };
}

export async function removeGmailConnection(clerkUserId: string) {
  const db = getSupabase();
  await db.from("gmail_connections").delete().eq("clerk_user_id", clerkUserId);
  await db.from("email_receipts").delete().eq("clerk_user_id", clerkUserId);
}
