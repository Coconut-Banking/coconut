import { getSupabase } from "./supabase";

const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

const PAYPAL_AUTH_BASE =
  process.env.PAYPAL_ENV === "sandbox"
    ? "https://www.sandbox.paypal.com"
    : "https://www.paypal.com";

const SCOPES = ["openid", "email", "https://uri.paypal.com/services/reporting/search/read"];

function getCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const redirectUri = process.env.PAYPAL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_REDIRECT_URI must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export function getAuthUrl(clerkUserId: string): string {
  const { clientId, redirectUri } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPES.join(" "),
    redirect_uri: redirectUri,
    state: clerkUserId,
  });
  return `${PAYPAL_AUTH_BASE}/signin/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal token exchange failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`PayPal token refresh failed: ${res.status}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export async function savePayPalTokens(
  clerkUserId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number },
  email?: string,
  paypalPayerId?: string
) {
  const db = getSupabase();
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error } = await db.from("paypal_connections").upsert(
    {
      clerk_user_id: clerkUserId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry: tokenExpiry,
      email: email ?? null,
      paypal_payer_id: paypalPayerId ?? null,
    },
    { onConflict: "clerk_user_id" }
  );

  if (error) throw error;
}

export async function getPayPalAccessToken(clerkUserId: string): Promise<string | null> {
  const db = getSupabase();
  const { data } = await db
    .from("paypal_connections")
    .select("access_token, refresh_token, token_expiry")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!data) return null;

  // Check if token is expired or will expire in the next 5 minutes
  const expiry = data.token_expiry ? new Date(data.token_expiry).getTime() : 0;
  if (Date.now() > expiry - 5 * 60 * 1000) {
    if (!data.refresh_token) return null;

    try {
      const refreshed = await refreshAccessToken(data.refresh_token);
      await savePayPalTokens(clerkUserId, refreshed);
      return refreshed.access_token;
    } catch {
      return null;
    }
  }

  return data.access_token;
}

export async function getPayPalStatus(clerkUserId: string) {
  const db = getSupabase();
  const { data } = await db
    .from("paypal_connections")
    .select("email, last_sync_at")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!data) return { connected: false, email: null, lastSyncAt: null };
  return { connected: true, email: data.email, lastSyncAt: data.last_sync_at };
}

export async function removePayPalConnection(clerkUserId: string) {
  const db = getSupabase();
  await db.from("paypal_connections").delete().eq("clerk_user_id", clerkUserId);
  // Also delete imported PayPal transactions
  await db.from("p2p_transactions").delete().eq("clerk_user_id", clerkUserId).eq("platform", "paypal");
}

export { PAYPAL_BASE };
