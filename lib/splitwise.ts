/**
 * Splitwise API client — handles OAuth and data fetching.
 *
 * Docs: https://dev.splitwise.com/
 * Base URL: https://secure.splitwise.com/api/v3.0
 */

const BASE = "https://secure.splitwise.com/api/v3.0";
const OAUTH_AUTHORIZE = "https://secure.splitwise.com/oauth/authorize";
const OAUTH_TOKEN = "https://secure.splitwise.com/oauth/token";

export function getSplitwiseConfig() {
  return {
    clientId: process.env.SPLITWISE_CLIENT_ID ?? "",
    clientSecret: process.env.SPLITWISE_CLIENT_SECRET ?? "",
    redirectUri:
      (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "") +
      "/api/splitwise/callback",
  };
}

/** Build the Splitwise OAuth authorization URL. */
export function getAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getSplitwiseConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${OAUTH_AUTHORIZE}?${params}`;
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = getSplitwiseConfig();
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Splitwise token exchange failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ── API types ───────────────────────────────────────────────────────────────

export interface SplitwiseUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface SplitwiseGroup {
  id: number;
  name: string;
  group_type: string;
  members: SplitwiseUser[];
  simplified_debts: { from: number; to: number; amount: string }[];
}

export interface SplitwiseExpenseShare {
  user_id: number;
  paid_share: string;
  owed_share: string;
}

export interface SplitwiseExpense {
  id: number;
  group_id: number;
  description: string;
  cost: string;
  currency_code: string;
  date: string; // ISO
  deleted_at: string | null;
  repayments: { from: number; to: number; amount: string }[];
  users: SplitwiseExpenseShare[];
  payment: boolean; // true = settlement, false = normal expense
}

// ── Fetchers ────────────────────────────────────────────────────────────────

async function swFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Splitwise API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getCurrentUser(token: string): Promise<SplitwiseUser> {
  const data = await swFetch<{ user: SplitwiseUser }>(token, "/get_current_user");
  return data.user;
}

export async function getGroups(token: string): Promise<SplitwiseGroup[]> {
  const data = await swFetch<{ groups: SplitwiseGroup[] }>(token, "/get_groups");
  // Filter out the "non-group expenses" placeholder (id=0)
  return data.groups.filter((g) => g.id !== 0);
}

export async function getExpenses(
  token: string,
  groupId: number,
  limit = 500
): Promise<SplitwiseExpense[]> {
  const data = await swFetch<{ expenses: SplitwiseExpense[] }>(
    token,
    `/get_expenses?group_id=${groupId}&limit=${limit}`
  );
  // Exclude deleted expenses
  return data.expenses.filter((e) => !e.deleted_at);
}
