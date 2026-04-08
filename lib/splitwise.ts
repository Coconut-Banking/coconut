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
  const appBase = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const explicit = process.env.SPLITWISE_REDIRECT_URI?.trim();
  // Must match Splitwise OAuth app settings exactly on both /authorize and /token requests.
  const redirectUri =
    explicit && explicit.length > 0
      ? explicit.replace(/\/$/, "")
      : `${appBase}/api/splitwise/callback`;
  return {
    clientId: process.env.SPLITWISE_CLIENT_ID ?? "",
    clientSecret: process.env.SPLITWISE_CLIENT_SECRET ?? "",
    redirectUri,
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
  simplified_debts: { from: number; to: number; amount: string; currency_code?: string }[];
  avatar?: { original?: string | null; xxlarge?: string; xlarge?: string; large?: string; medium?: string; small?: string };
  custom_avatar?: boolean;
  cover_photo?: { xxlarge?: string; xlarge?: string };
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
  details: string | null;
  cost: string;
  currency_code: string;
  date: string; // ISO
  deleted_at: string | null;
  repayments: { from: number; to: number; amount: string }[];
  users: SplitwiseExpenseShare[];
  payment: boolean;
  category?: { id: number; name: string };
  receipt?: { large: string | null; original: string | null };
  created_by?: { id: number; first_name: string; last_name: string };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

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

async function swPost<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Splitwise POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getCurrentUser(token: string): Promise<SplitwiseUser> {
  const data = await swFetch<{ user: SplitwiseUser }>(token, "/get_current_user");
  return data.user;
}

/** Per-currency balance with a friend (Splitwise API shape). */
export interface SplitwiseFriendBalanceRow {
  currency_code: string;
  amount: string;
}

/** Friend row from GET /get_friends (dev.splitwise.com). */
export interface SplitwiseFriendRow {
  id: number;
  first_name: string;
  last_name: string;
  email?: string;
  balance?: SplitwiseFriendBalanceRow[];
}

export async function getFriends(token: string): Promise<SplitwiseFriendRow[]> {
  const data = await swFetch<{ friends: SplitwiseFriendRow[] }>(token, "/get_friends");
  return data.friends ?? [];
}

export async function getGroups(token: string): Promise<SplitwiseGroup[]> {
  const data = await swFetch<{ groups: SplitwiseGroup[] }>(token, "/get_groups");
  // id=0 is Splitwise "non-group expenses" — not imported yet; balances there won't appear in Coconut.
  return data.groups.filter((g) => g.id !== 0);
}

export interface GetExpensesOptions {
  limitPerPage?: number;
  datedAfter?: string;
  updatedAfter?: string;
  maxPages?: number;
}

export async function getExpenses(
  token: string,
  groupId: number,
  options: GetExpensesOptions = {}
): Promise<SplitwiseExpense[]> {
  const limitPerPage = Math.min(Math.max(options.limitPerPage ?? 200, 1), 500);
  const maxPages = Math.min(Math.max(options.maxPages ?? 50, 1), 500);
  const all: SplitwiseExpense[] = [];

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      group_id: String(groupId),
      limit: String(limitPerPage),
      offset: String(page * limitPerPage),
    });
    if (options.datedAfter) params.set("dated_after", options.datedAfter);
    if (options.updatedAfter) params.set("updated_after", options.updatedAfter);

    const data = await swFetch<{ expenses: SplitwiseExpense[] }>(
      token,
      `/get_expenses?${params.toString()}`
    );
    const pageItems = (data.expenses ?? []).filter((e) => !e.deleted_at);
    all.push(...pageItems);

    if ((data.expenses ?? []).length < limitPerPage) {
      break;
    }
  }

  return all;
}

// ── Read: single group ───────────────────────────────────────────────────────

export async function getGroup(token: string, groupId: number): Promise<SplitwiseGroup> {
  const data = await swFetch<{ group: SplitwiseGroup }>(token, `/get_group/${groupId}`);
  return data.group;
}

// ── Write helpers ────────────────────────────────────────────────────────────

export interface SwExpenseUserShare {
  user_id: number;
  paid_share: string;
  owed_share: string;
}

export interface CreateSwExpenseParams {
  group_id: number;
  description: string;
  cost: string;
  currency_code: string;
  date?: string;
  payment?: boolean;
  users: SwExpenseUserShare[];
}

/**
 * Create an expense (or payment/settlement) in Splitwise.
 * Returns the created expense ID, or throws on error.
 */
export async function createSwExpense(
  token: string,
  params: CreateSwExpenseParams
): Promise<{ id: number }> {
  const body: Record<string, unknown> = {
    group_id: params.group_id,
    description: params.description,
    cost: params.cost,
    currency_code: params.currency_code,
  };
  if (params.date) body.date = params.date;
  if (params.payment) body.payment = true;

  for (let i = 0; i < params.users.length; i++) {
    const u = params.users[i];
    body[`users__${i}__user_id`] = u.user_id;
    body[`users__${i}__paid_share`] = u.paid_share;
    body[`users__${i}__owed_share`] = u.owed_share;
  }

  const res = await swPost<{ expenses: SplitwiseExpense[]; errors?: Record<string, string[]> }>(
    token,
    "/create_expense",
    body
  );

  if (res.errors && Object.keys(res.errors).length > 0) {
    throw new Error(`Splitwise create_expense errors: ${JSON.stringify(res.errors)}`);
  }
  const created = res.expenses?.[0];
  if (!created) throw new Error("Splitwise create_expense returned no expense");
  return { id: created.id };
}

/**
 * Update an expense in Splitwise. Only include fields that changed.
 */
export async function updateSwExpense(
  token: string,
  expenseId: number,
  params: Partial<CreateSwExpenseParams>
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (params.description !== undefined) body.description = params.description;
  if (params.cost !== undefined) body.cost = params.cost;
  if (params.currency_code !== undefined) body.currency_code = params.currency_code;
  if (params.date !== undefined) body.date = params.date;

  if (params.users) {
    for (let i = 0; i < params.users.length; i++) {
      const u = params.users[i];
      body[`users__${i}__user_id`] = u.user_id;
      body[`users__${i}__paid_share`] = u.paid_share;
      body[`users__${i}__owed_share`] = u.owed_share;
    }
  }

  const res = await swPost<{ expenses: SplitwiseExpense[]; errors?: Record<string, string[]> }>(
    token,
    `/update_expense/${expenseId}`,
    body
  );

  if (res.errors && Object.keys(res.errors).length > 0) {
    throw new Error(`Splitwise update_expense errors: ${JSON.stringify(res.errors)}`);
  }
}

/**
 * Soft-delete an expense in Splitwise.
 */
export async function deleteSwExpense(token: string, expenseId: number): Promise<void> {
  await swPost<{ success: boolean }>(token, `/delete_expense/${expenseId}`, {});
}

/**
 * Create a group in Splitwise. Returns the new group ID.
 */
export async function createSwGroup(
  token: string,
  name: string,
  groupType?: string
): Promise<{ id: number }> {
  const body: Record<string, unknown> = { name };
  if (groupType) body.group_type = groupType;
  const res = await swPost<{ group: SplitwiseGroup }>(token, "/create_group", body);
  return { id: res.group.id };
}

/**
 * Add a user to a Splitwise group.
 */
export async function addUserToSwGroup(
  token: string,
  groupId: number,
  user: { user_id?: number; email?: string; first_name?: string; last_name?: string }
): Promise<void> {
  const body: Record<string, unknown> = { group_id: groupId };
  if (user.user_id) {
    body.users__0__user_id = user.user_id;
  } else {
    if (user.email) body.users__0__email = user.email;
    if (user.first_name) body.users__0__first_name = user.first_name;
    if (user.last_name) body.users__0__last_name = user.last_name;
  }
  await swPost<unknown>(token, "/add_user_to_group", body);
}
