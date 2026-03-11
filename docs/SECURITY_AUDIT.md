# Coconut Security Audit Report

**Date:** March 10, 2026  
**Auditor:** Automated Security Agent  
**Scope:** Full application — API routes, authentication, payment processing, data security, infrastructure  
**Application:** Next.js 16 banking app with Clerk auth, Supabase (PostgreSQL), Plaid (banking), Stripe (payments), OpenAI (LLM features), Gmail (receipt scanning)

---

## Executive Summary

The Coconut application contains **multiple critical and high-severity vulnerabilities** that expose it to data theft, financial manipulation, and account takeover. The most severe systemic issue is the **exclusive use of the Supabase service role key** across all API routes, which bypasses Row Level Security (RLS) entirely. Although RLS is "enabled" at the schema level, no RLS policies are ever defined, meaning the service key has unrestricted access to all rows in all tables. Combined with several IDOR (Insecure Direct Object Reference) vulnerabilities, any authenticated user could access or modify another user's financial data.

The payment layer (Stripe + settlements) trusts client-supplied metadata (group IDs, member IDs, payment amounts) without server-side ownership verification in critical paths. The LLM integration routes pass unsanitized user input directly into system prompts, creating prompt injection vectors. There is zero rate limiting on any endpoint, including those that call expensive external APIs (OpenAI, Plaid, Gmail).

File upload handling accepts arbitrary file types without validation, the Plaid access token is written to a plaintext file on disk in development, and several API routes expose internal error messages including database schema details to clients. The application lacks a `middleware.ts` file — the Clerk middleware lives in `proxy.ts` but is not automatically picked up by Next.js, potentially leaving all routes unprotected at the framework level.

**Key Statistics:**
- **50 API route files** examined
- **38 lib files** examined  
- **11 hooks** examined
- **9 SQL schema/migration files** examined
- **0 RLS policies** defined (despite RLS being enabled)
- **0 rate-limited** endpoints
- **0 input validation** libraries used (no zod, joi, yup, etc.)

---

## Risk Matrix

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 6 | Immediate exploitation risk; data breach or financial loss |
| **HIGH** | 10 | Significant risk; exploitation likely with minimal effort |
| **MEDIUM** | 9 | Moderate risk; requires specific conditions or chained exploits |
| **LOW** | 5 | Minor risk; defense-in-depth improvements |
| **INFO** | 7 | Best practices and hardening recommendations |

---

## Critical Findings

### CRIT-01: No RLS Policies Defined — Service Role Key Bypasses All Row Security

**File:** `docs/supabase-schema.sql` (lines 69–75, 171–175), `lib/supabase.ts` (lines 14–20)  
**Description:** RLS is enabled on all tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`), but **zero RLS policies** are ever created. The `getSupabaseAdmin()` / `getSupabase()` function uses the service role key, which bypasses RLS by design. Since the service role key is the *only* client used across the entire application, RLS provides zero protection.

**Impact:** If any API route has an authorization flaw (see CRIT-02, CRIT-03), the Supabase layer provides no defense-in-depth. The service role key has unrestricted read/write access to every row in every table, including other users' Plaid access tokens, Gmail OAuth tokens, financial transactions, and bank account data.

**Proof of Concept:** Every API route calls `getSupabase()` which returns the service role client. Any query that fails to filter by `clerk_user_id` will return or modify all users' data.

**Remediation:**
1. Create proper RLS policies on every table (e.g., `CREATE POLICY "users_own_data" ON transactions FOR ALL USING (clerk_user_id = current_setting('request.jwt.claims')::json->>'sub')`)
2. Create a `getSupabaseForUser(userId)` function that uses the anon key with Clerk JWT for RLS enforcement
3. Reserve `getSupabaseAdmin()` exclusively for webhooks and background jobs

**Effort:** 2–3 days

---

### CRIT-02: IDOR in Receipt Finish Route — Missing Group Membership Check

**File:** `app/api/receipt/[id]/finish/route.ts` (lines 55–64)  
**Description:** The `/api/receipt/[id]/finish` endpoint verifies receipt ownership (`clerk_user_id = userId`) but does **not** verify the user has access to the `groupId` supplied in the request body. It fetches the group directly without calling `canAccessGroup()`:

```typescript
const { data: group } = await db
  .from("groups")
  .select("id, owner_id, name")
  .eq("id", groupId)
  .single();

if (!group) {
  return NextResponse.json({ error: "Group not found" }, { status: 404 });
}
```

**Impact:** An authenticated user can create split transactions in any group they don't belong to, potentially manipulating other users' balances and settlements. They can insert arbitrary expense shares affecting other users' "you owe" calculations.

**Remediation:** Add `canAccessGroup(userId, groupId)` check before proceeding.

**Effort:** 30 minutes

---

### CRIT-03: Plaid Access Tokens Stored in Plaintext with Service Key Access

**File:** `docs/supabase-schema.sql` (line 14), `lib/transaction-sync.ts` (lines 39–47, 49–65), `lib/plaid-client.ts` (lines 39–64)  
**Description:** Plaid access tokens (which grant full read access to a user's bank accounts and transaction history) are stored in plaintext in the `plaid_items` table column `access_token TEXT NOT NULL`. Any vulnerability that allows reading from this table exposes all users' bank connections. Additionally, `lib/plaid-client.ts` writes the Plaid access token to a plaintext file (`.plaid-token.json`) on the filesystem:

```typescript
const TOKEN_FILE = path.join(process.cwd(), ".plaid-token.json");

function writeTokenFile(accessToken: string, itemId: string) {
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ access_token: accessToken, item_id: itemId }, null, 0),
    "utf-8"
  );
}
```

**Impact:** Plaid access tokens grant persistent access to a user's bank accounts. If the database is compromised, or the filesystem is accessible (e.g., via path traversal or server misconfiguration), all linked bank accounts are exposed. The plaintext file persists across server restarts and is not in `.gitignore`.

**Remediation:**
1. Encrypt Plaid access tokens at rest using a separate encryption key (e.g., AES-256-GCM)
2. Remove the `.plaid-token.json` filesystem storage entirely (it's a dev artifact that shouldn't exist)
3. Add `.plaid-token.json` to `.gitignore` immediately
4. Rotate any Plaid access tokens that may have been committed to git

**Effort:** 1 day

---

### CRIT-04: Gmail OAuth Tokens Stored in Plaintext

**File:** `lib/google-auth.ts` (lines 35–60, 62–91)  
**Description:** Gmail OAuth access tokens and refresh tokens are stored in plaintext in the `gmail_connections` table. The refresh token grants long-lived access to a user's Gmail inbox. The `getGmailClient` function reads these tokens and uses them to access Gmail:

```typescript
const { data } = await db
  .from("gmail_connections")
  .select("access_token, refresh_token, token_expiry")
  .eq("clerk_user_id", clerkUserId)
  .single();
```

**Impact:** If the database is compromised, attackers gain persistent access to users' Gmail inboxes via stored refresh tokens. This is particularly dangerous because the app requests `gmail.readonly` scope, which allows reading all email content.

**Remediation:** Encrypt OAuth tokens at rest. Use a dedicated secrets manager or envelope encryption.

**Effort:** 1 day

---

### CRIT-05: Stripe Payment Metadata Trusted from Client — Settlement Amount Manipulation

**File:** `app/api/stripe/create-payment-link/route.ts` (lines 44–49), `app/api/stripe/terminal/create-payment-intent/route.ts` (lines 41–47)  
**Description:** Both Stripe payment creation endpoints accept `groupId`, `payerMemberId`, and `receiverMemberId` directly from the client request body and pass them as Stripe metadata without verifying that:
1. The authenticated user is a member of the group
2. The `payerMemberId` and `receiverMemberId` are valid members of that group
3. The user has authority to create a payment for these members

```typescript
const metadata: Record<string, string> = {};
if (body.groupId && body.payerMemberId && body.receiverMemberId) {
  metadata.group_id = body.groupId;
  metadata.payer_member_id = body.payerMemberId;
  metadata.receiver_member_id = body.receiverMemberId;
}
```

When the Stripe webhook fires (`app/api/stripe/webhook/route.ts`), it trusts this metadata to record settlements. While the webhook does cap the settlement amount via `getMaxSettlementAllowed()`, the group/member IDs are never validated at creation time.

**Impact:** An attacker can create payment links that, when paid, record settlements in groups they don't belong to, potentially zeroing out other users' balances.

**Remediation:** Validate `canAccessGroup(userId, groupId)` and verify member IDs belong to the group before creating the Stripe session.

**Effort:** 1 hour

---

### CRIT-06: Middleware File Naming — `proxy.ts` Instead of `middleware.ts`

**File:** `proxy.ts` (root directory)  
**Description:** Next.js requires the Clerk middleware to be in a file named `middleware.ts` (or `middleware.js`) at the project root. The middleware is defined in `proxy.ts`, which Next.js will **not** automatically pick up as middleware. If this file is not correctly imported/aliased, all API routes may be accessible without Clerk authentication at the framework level, relying solely on in-route `auth()` calls.

Searching the project, there is no `middleware.ts` file:

```
Glob for middleware.ts → 0 files found
```

**Impact:** If Next.js is not configured to use `proxy.ts` as middleware (via a custom config or re-export), the Clerk `auth.protect()` gate is not enforced, and all non-public routes become accessible without authentication. Each route's individual `auth()` check becomes the only line of defense.

**Remediation:** Rename `proxy.ts` to `middleware.ts` or create a `middleware.ts` that re-exports from `proxy.ts`. Verify in the Next.js config that middleware is being applied.

**Effort:** 15 minutes

---

## High Findings

### HIGH-01: No Rate Limiting on Any Endpoint

**Files:** All 50 API route files  
**Description:** The application has **zero rate limiting** on any endpoint. This includes endpoints that call expensive external APIs:
- `/api/chat` → OpenAI GPT-4o-mini (per-token billing)
- `/api/nl-search` → OpenAI (intent extraction + optional embeddings)
- `/api/nl-parse` → OpenAI GPT-4o-mini
- `/api/receipt/parse` → OpenAI GPT-4o (vision model, most expensive)
- `/api/gmail/scan` → Gmail API + OpenAI (per email)
- `/api/plaid/transactions` (POST) → Plaid sync + OpenAI embeddings
- `/api/plaid/create-link-token` → Plaid API
- `/api/groups/[id]/listen` → SSE long-lived connection (resource exhaustion)

**Impact:** Any authenticated user can run up unlimited API costs. A single user could rack up thousands of dollars in OpenAI bills by spamming `/api/receipt/parse` or `/api/chat`. The SSE endpoint could be used to exhaust server connections.

**Remediation:** Implement rate limiting using Vercel Edge Config, Upstash Redis, or `next-rate-limit`. Suggested limits:
- LLM endpoints: 20 req/min per user
- Receipt parse: 10 req/min per user
- Gmail scan: 2 req/min per user
- SSE: 5 concurrent per user

**Effort:** 1–2 days

---

### HIGH-02: No File Upload Validation on Receipt Parse

**File:** `app/api/receipt/parse/route.ts` (lines 13–22)  
**Description:** The receipt upload endpoint accepts any file from FormData without validating:
- File type / MIME type (attacker can upload executables, HTML, SVGs with scripts)
- File size (no limit — can send multi-GB files)
- File content (the `file.type` is trusted from the client, never verified)

```typescript
const file = formData.get("image") as File | null;
if (!file) {
  return NextResponse.json({ error: "image file required" }, { status: 400 });
}
const buffer = Buffer.from(await file.arrayBuffer());
const base64 = buffer.toString("base64");
const mimeType = file.type || "image/png"; // Client-controlled
```

The base64-encoded file content is then stored in the database (`image_base64` column) and later sent to OpenAI's vision API.

**Impact:** 
1. **DoS via large files:** No size limit means a multi-GB upload could crash the server or exhaust memory
2. **Stored XSS:** If the stored base64 image is ever rendered in an `<img>` tag with a `data:` URI from user-controlled MIME type, an SVG with embedded JavaScript could execute
3. **Cost attack:** Large images sent to GPT-4o vision are expensive

**Remediation:**
1. Validate MIME type server-side (allow only `image/jpeg`, `image/png`, `image/webp`)
2. Enforce maximum file size (e.g., 10MB)
3. Validate file magic bytes, not just client-supplied MIME type

**Effort:** 1 hour

---

### HIGH-03: Prompt Injection in LLM Routes

**Files:** `app/api/chat/route.ts` (lines 33–46), `app/api/nl-parse/route.ts` (lines 14–37), `lib/search-engine.ts` (lines 77–124), `lib/openai.ts` (lines 43–45), `lib/receipt-ocr.ts` (lines 11–44)  
**Description:** User input is interpolated directly into LLM system prompts without any sanitization. For example, in `search-engine.ts`:

```typescript
const prompt = `...
User query: "${query.trim()}"`;
```

And in `openai.ts`:

```typescript
const content = `Subscription summary:\n${subscriptionsSummary}\n\nRelevant transactions:\n${txContext}\n\nUser question: ${userMessage}`;
```

**Impact:** An attacker can craft input that overrides the system prompt to:
1. Exfiltrate other users' data if the LLM has access to it (in the chat route, transaction data is included in context)
2. Cause the LLM to return fabricated financial data
3. Extract the system prompt itself
4. In the receipt OCR route, a crafted image could cause the parser to return arbitrary JSON

**Remediation:**
1. Sanitize user input before inclusion in prompts (escape special characters, strip instruction-like patterns)
2. Use structured message arrays with strict role separation
3. Validate LLM output against expected schemas
4. Consider using OpenAI's moderation API as a pre-filter

**Effort:** 2–3 days

---

### HIGH-04: IDOR in Settlement Recording — Member ID Not Verified

**File:** `app/api/settlements/route.ts` (lines 11–14)  
**Description:** The settlements endpoint accepts `payerMemberId` and `receiverMemberId` from the client and only checks `canAccessGroup()`. It does **not** verify that the authenticated user is actually one of the members involved in the settlement:

```typescript
const payerMemberId = body.payerMemberId ?? body.payer_member_id;
const receiverMemberId = body.receiverMemberId ?? body.receiver_member_id;
```

**Impact:** Any group member can record settlements between any two other members in the group, potentially manipulating who owes what. A malicious group member could mark debts as paid that weren't.

**Remediation:** Verify that the authenticated user's member ID matches either `payerMemberId` or `receiverMemberId`, or restrict settlement recording to group owners.

**Effort:** 30 minutes

---

### HIGH-05: IDOR in Split Transactions — Can Split Other Users' Transactions

**File:** `app/api/split-transactions/route.ts` (lines 28–33)  
**Description:** The split transaction endpoint checks that the transaction belongs to `userId`, which is correct. However, `shares[].memberId` values from the client are never validated against actual group members:

```typescript
const shareRows = shares
  .filter((s) => Number(s.amount) > 0)
  .map((s) => ({
    split_transaction_id: split.id,
    member_id: s.memberId, // Client-supplied, not validated
    amount: Number(s.amount),
  }));
```

**Impact:** Arbitrary UUIDs can be inserted as `member_id` in `split_shares`, potentially linking shares to members in other groups or non-existent members.

**Remediation:** Validate that all `memberId` values in `shares[]` are actual members of the specified group.

**Effort:** 30 minutes

---

### HIGH-06: Demo Mode Cookie Can Bypass Auth in Non-Production

**Files:** `lib/demo.ts` (lines 29–35), `app/api/demo/route.ts` (lines 6–8)  
**Description:** The demo mode system allows anyone to access the app as `DEMO_USER_ID` by setting a cookie. While `getEffectiveUserId()` checks `process.env.NODE_ENV !== "production"`, the `isDemoMode()` function that sets the cookie only checks for production in the POST route, not in the utility function itself. If `NODE_ENV` is not explicitly set to `"production"` in a deployed environment (e.g., a staging server), demo mode is available.

Several routes use `getEffectiveUserId()` instead of direct Clerk `auth()`:
- `/api/plaid/exchange-token`
- `/api/plaid/create-link-token`
- `/api/plaid/disconnect`
- `/api/plaid/wipe`
- `/api/plaid/status`
- `/api/plaid/transactions` (GET)
- `/api/nl-search`
- `/api/subscriptions` (GET)

**Impact:** On any non-production deployment (staging, preview), an unauthenticated user can set the demo cookie and access all demo user data, including any real data associated with the `demo-sandbox-user` ID.

**Remediation:** 
1. Never allow demo mode on deployed environments — check `VERCEL_ENV` or a dedicated flag
2. Isolate demo data completely from production data
3. Use `auth()` consistently across all routes

**Effort:** 2 hours

---

### HIGH-07: Database Error Messages Leaked to Clients

**Files:** Multiple API routes  
**Description:** Several routes return raw Supabase error messages to the client:

- `app/api/groups/route.ts` line 76: `error: groupErr?.message`
- `app/api/groups/[id]/members/route.ts` line 37: `error: error.message`
- `app/api/receipt/parse/route.ts` line 71: `details: msg` (includes "does not exist" hints)
- `app/api/groups/[id]/settlements/route.ts` line 26: `error: error.message`
- `app/api/split-transactions/route.ts` line 71: `error: splitErr?.message`
- `app/api/manual-expense/route.ts` lines 113, 163: `error: txError?.message`, `error: shareErr.message`
- `app/api/settlements/route.ts` line 58: `error: error.message`
- `app/api/subscriptions/[id]/route.ts` line 26: `error: error.message`
- `app/api/stripe/create-payment-link/route.ts` line 88: `error: e.message`

**Impact:** Database error messages can reveal table names, column names, constraint names, and data types to attackers, aiding further exploitation.

**Remediation:** Return generic error messages to clients; log detailed errors server-side only.

**Effort:** 2 hours

---

### HIGH-08: Split Transaction DELETE — Any Group Member Can Delete Any Split

**File:** `app/api/split-transactions/[id]/route.ts` (lines 6–38)  
**Description:** The DELETE endpoint only checks `canAccessGroup()` — any member of the group can delete any split transaction in that group, not just the one who created it:

```typescript
const allowed = await canAccessGroup(userId, split.group_id);
if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
await db.from("split_transactions").delete().eq("id", id);
```

Additionally, if deleting the last split clears all settlements (`count === 0 → delete all settlements`), a malicious member could delete one split at a time and trigger settlement deletion.

**Impact:** A disgruntled group member can delete all shared expenses and settlements in a group, wiping out the financial record.

**Remediation:** Restrict deletion to the split creator or group owner. Add audit logging for destructive operations.

**Effort:** 1 hour

---

### HIGH-09: `SKIP_AUTH` Flag Has No Production Kill Switch

**File:** `lib/auth.ts` (lines 4–6)  
**Description:** The `SKIP_AUTH` flag checks `process.env.NODE_ENV !== "production"`, which is the only guard:

```typescript
const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  String(process.env.SKIP_AUTH ?? "").trim().toLowerCase() === "true";
```

While the production check exists, `NEXT_PUBLIC_SKIP_AUTH` (used in `AppGate.tsx` client-side) only checks the env var without any server-side enforcement:

```typescript
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
```

**Impact:** If `NEXT_PUBLIC_SKIP_AUTH=true` is accidentally set in a production build, the client-side auth gate is completely bypassed. Since `NEXT_PUBLIC_*` vars are baked into the client bundle at build time, this could affect all users.

**Remediation:** Add a runtime check that throws/panics if `SKIP_AUTH` is true and the environment appears to be production (check `VERCEL_ENV`, `VERCEL_URL`, etc.).

**Effort:** 30 minutes

---

### HIGH-10: Debug Endpoint Exposes User Identity

**File:** `app/api/debug/me/route.ts` (lines 1–15)  
**Description:** The `/api/debug/me` endpoint returns the authenticated user's Clerk ID. While it checks `NODE_ENV === "production"`, it's a route that should not exist in the codebase at all:

```typescript
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { userId } = await auth();
  return NextResponse.json({ userId: userId ?? null });
}
```

Similarly, `/api/gmail/debug-amazon` is a debug route that exposes Gmail search results.

**Impact:** On non-production deployments, these endpoints leak internal IDs and user email data.

**Remediation:** Remove debug endpoints entirely from the codebase, or gate them behind an admin-only flag.

**Effort:** 15 minutes

---

## Medium Findings

### MED-01: No Input Length Validation on Any Endpoint

**Files:** All POST/PATCH API routes  
**Description:** No route validates input string lengths. For example:
- Group names have no max length (`app/api/groups/route.ts` line 44)
- Display names have no max length (`app/api/groups/[id]/members/route.ts` line 14)
- Manual expense descriptions have no max length (`app/api/manual-expense/route.ts` line 22)
- Chat messages have no max length (`app/api/chat/route.ts` line 13)
- Search queries have no max length (`app/api/nl-search/route.ts`, `app/api/search/route.ts`)

**Impact:** Attackers can submit extremely long strings that:
1. Consume excessive database storage
2. Cause expensive LLM API calls (longer prompts = more tokens = more cost)
3. Potentially cause OOM errors in string processing

**Remediation:** Add input validation with a library like `zod`. Define max lengths for all string inputs.

**Effort:** 1 day

---

### MED-02: No CSRF Protection Beyond SameSite Cookies

**Files:** N/A (framework-level)  
**Description:** The application relies on Clerk's JWT-based auth and `SameSite=lax` cookies for CSRF protection. However, `SameSite=lax` still allows GET requests from cross-origin navigations. Several state-changing operations use GET requests:
- `/api/gmail/auth` (GET) — initiates OAuth flow
- `/api/gmail/debug-amazon` (GET) — triggers Gmail API calls
- `/api/plaid/status` (GET) — no state change, but information disclosure

**Impact:** A malicious site could trigger the Gmail OAuth flow for a logged-in user via a simple link/redirect.

**Remediation:** Use POST for all state-changing operations. Add CSRF tokens for sensitive operations.

**Effort:** 2 hours

---

### MED-03: Excessive Logging of Sensitive Data

**Files:** `lib/google-auth.ts` (lines 40, 55–56, 59, 103), `app/api/gmail/callback/route.ts` (lines 27–29, 55–58, 69), `app/api/gmail/auth/route.ts` (line 8), `app/api/plaid/exchange-token/route.ts` (line 50)  
**Description:** Multiple files log sensitive information including:
- OAuth token existence and expiry dates
- User IDs and email addresses
- Plaid sync results with user identifiers
- Gmail connection states

```typescript
console.log("[Gmail Callback] Token exchange successful:", {
  hasAccessToken: !!tokens.access_token,
  hasRefreshToken: !!tokens.refresh_token,
  expiryDate: tokens.expiry_date
});
```

**Impact:** If logs are accessible (e.g., via Vercel logs, log aggregation services), sensitive user metadata is exposed.

**Remediation:** Remove sensitive data from log statements. Use structured logging with redaction for PII.

**Effort:** 2 hours

---

### MED-04: No Schema Validation — All Routes Trust `req.json()` Shape

**Files:** All POST/PATCH routes  
**Description:** Every POST route destructures the JSON body without type validation:

```typescript
const body = await req.json();
const name = (body.name as string)?.trim();
```

Type assertions (`as string`, `as number`) do not actually validate at runtime. If `body.name` is an object, array, or number, `?.trim()` may throw or behave unexpectedly.

**Impact:** Unexpected input types could cause runtime errors, logic bypasses, or unexpected database insertions.

**Remediation:** Use `zod` or `valibot` for runtime schema validation on every POST/PATCH route.

**Effort:** 2 days

---

### MED-05: `invite_token` Exposed in Group List Response

**File:** `app/api/groups/route.ts` (line 18)  
**Description:** The group list endpoint returns `invite_token` to all group members:

```typescript
.select("id, name, owner_id, created_at, group_type, invite_token")
```

**Impact:** Any group member can see the invite token and share it. While this may be intentional, it should be restricted to group owners only, as the invite token could allow unauthorized users to join the group.

**Remediation:** Only include `invite_token` in responses for the group owner. Return `null` for other members.

**Effort:** 15 minutes

---

### MED-06: Settlement DELETE Clears All Settlements — No Audit Trail

**File:** `app/api/groups/[id]/settlements/route.ts` (lines 9–28)  
**Description:** The DELETE endpoint for settlements clears **all** settlements for a group in one call, with no confirmation, no soft delete, and no audit trail:

```typescript
const { error } = await db.from("settlements").delete().eq("group_id", id);
```

Only the group owner can perform this, which is correct, but there's no record of the deletion.

**Impact:** Financial records are permanently destroyed with no recovery path. This could be used to dispute payments that were actually made.

**Remediation:** Implement soft deletes (status = 'deleted') or archive settlements before deletion. Add audit logging.

**Effort:** 2 hours

---

### MED-07: Gmail OAuth State Parameter Not Cryptographically Signed

**File:** `lib/google-auth.ts` (lines 16–27), `app/api/gmail/callback/route.ts` (lines 6–14, 37–44)  
**Description:** The OAuth state parameter contains the Clerk user ID (either as a plain string or JSON). While the callback verifies the state's user ID matches the authenticated user, the state itself is not cryptographically signed:

```typescript
const state = mobileRedirect
  ? JSON.stringify({ userId: clerkUserId, redirect: mobileRedirect })
  : clerkUserId;
```

**Impact:** If an attacker can manipulate the state parameter during the OAuth flow, they could potentially link their Gmail to another user's account. The callback does check `authedUserId !== clerkUserId`, which mitigates this, but a CSRF-style attack could exploit timing.

**Remediation:** Use a cryptographically random state value stored in a server-side session, not the user ID directly.

**Effort:** 1 hour

---

### MED-08: `userId` from `body.userId` Accepted in Member Creation

**File:** `app/api/groups/[id]/members/route.ts` (line 30)  
**Description:** When adding a member to a group, the `user_id` field is taken directly from the request body:

```typescript
user_id: body.userId ?? null,
```

This allows the group owner to associate any Clerk user ID with a group member record. If a valid Clerk user ID is guessed/known, that user would gain access to the group (via `canAccessGroup()` which checks `group_members.user_id`).

**Impact:** A group owner can forcibly add any user to their group by guessing their Clerk user ID, which would give them access to the group's financial data.

**Remediation:** Only allow `user_id` to be set via the invite flow (email-based linking), not directly from the request body.

**Effort:** 30 minutes

---

### MED-09: Open Redirect in Gmail OAuth Callback

**File:** `app/api/gmail/callback/route.ts` (lines 16–18, 48–49)  
**Description:** The callback accepts a `redirect` parameter from the OAuth state. While `isAllowedRedirect` validates it, it allows `coconut://` scheme URLs:

```typescript
function isAllowedRedirect(url: string): boolean {
  return url.startsWith("coconut://") || url.startsWith("/");
}
```

The `coconut://` scheme is for mobile deep links, but the validation doesn't prevent `coconut://evil.com` or similar payloads that might be handled differently by various mobile URL handlers.

**Impact:** An attacker who can control the state parameter could redirect users to a malicious deep link after OAuth completion.

**Remediation:** Validate the full URL structure for custom schemes. Use an allowlist of specific redirect paths.

**Effort:** 30 minutes

---

## Low Findings

### LOW-01: No Content-Security-Policy Headers

**File:** `next.config.js` (empty config)  
**Description:** The Next.js config is empty — no security headers are configured:

```javascript
const nextConfig = {};
module.exports = nextConfig;
```

**Impact:** The application is vulnerable to XSS payloads that could load external scripts, frames, or styles.

**Remediation:** Add security headers in `next.config.js`:
```javascript
const nextConfig = {
  headers: async () => [{
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ],
  }],
};
```

**Effort:** 1 hour

---

### LOW-02: No `Strict-Transport-Security` (HSTS) Header

**File:** `next.config.js`  
**Description:** No HSTS header is set, meaning browsers don't enforce HTTPS.

**Impact:** Users could be downgraded to HTTP via man-in-the-middle attacks on first visit.

**Remediation:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to response headers.

**Effort:** 15 minutes

---

### LOW-03: Demo Cookie Secure Flag Only Set in Production

**File:** `app/api/demo/route.ts` (line 15)  
**Description:** The demo mode cookie's `secure` flag is only set when `NODE_ENV === "production"`:

```typescript
secure: String(process.env.NODE_ENV) === "production",
```

**Impact:** In non-production environments over HTTP, the cookie could be intercepted.

**Remediation:** Always set `secure: true` when deployed (check for HTTPS, not just NODE_ENV).

**Effort:** 15 minutes

---

### LOW-04: `any` Type Usage in Multiple Files

**Files:** `lib/receipt-parser.ts` (lines 185, 331), `app/api/gmail/debug-amazon/route.ts` (line 25)  
**Description:** Several files use `any` types, bypassing TypeScript's type checking:

```typescript
let receipts: any[] = [];
const results: any[] = [];
```

**Impact:** Type errors may go undetected, potentially causing runtime issues.

**Remediation:** Replace `any` with proper types or `unknown` with type guards.

**Effort:** 1 hour

---

### LOW-05: No Request ID or Correlation ID for Debugging

**Files:** All API routes  
**Description:** No routes generate or propagate request IDs, making it difficult to trace requests through logs.

**Impact:** Debugging production issues and security incidents is significantly harder.

**Remediation:** Add a middleware that generates a unique request ID and includes it in all log statements and error responses.

**Effort:** 2 hours

---

## Informational / Best Practices

### INFO-01: No Dependency Vulnerability Scanning

**File:** `package.json`  
**Description:** No Dependabot, Snyk, or similar dependency scanning is configured. The project uses major packages (Next.js 16, Clerk, Supabase, Stripe, Plaid, OpenAI) that receive frequent security updates. A lockfile (`package-lock.json`) exists, which is good.

**Recommendation:** Enable Dependabot or Snyk on the GitHub repository.

---

### INFO-02: No Error Monitoring Service

**Description:** No Sentry, Datadog, or similar error monitoring is configured. Errors are only logged to `console.error` / `console.warn`.

**Recommendation:** Integrate Sentry for error tracking with PII scrubbing configured.

---

### INFO-03: No API Versioning

**Description:** All API routes are unversioned (`/api/...`). Breaking changes to APIs will affect all clients simultaneously.

**Recommendation:** Consider versioning critical APIs (e.g., `/api/v1/...`) before the app has significant user adoption.

---

### INFO-04: Supabase Realtime Enabled Without Auth Scoping

**File:** `docs/supabase-realtime-enable.sql`, `app/api/groups/[id]/listen/route.ts`  
**Description:** The SSE endpoint subscribes to Supabase Realtime changes filtered by `group_id`. Since RLS has no policies, the Realtime subscription using the service key receives all changes. The route itself checks `canAccessGroup()`, which is correct, but the Supabase channel filter is string-interpolated:

```typescript
filter: `group_id=eq.${id}`,
```

**Recommendation:** Ensure the `id` is validated as a UUID before interpolation to prevent filter injection.

---

### INFO-05: Transaction Deduplication Logic in GET Route Has Side Effects

**File:** `app/api/plaid/transactions/route.ts` (lines 51–59)  
**Description:** The GET handler for transactions performs **writes** (deleting duplicate transactions) as a side effect of reading data:

```typescript
if (idsToDelete.length > 0) {
  await db.from("transactions").delete().in("id", idsToDelete);
}
```

**Recommendation:** Move data cleanup to a dedicated background job or POST endpoint. GET requests should be idempotent.

---

### INFO-06: No Webhook Replay Protection for Stripe

**File:** `app/api/stripe/webhook/route.ts`  
**Description:** The webhook checks for existing settlements by `external_reference` to prevent duplicate processing, which is good. However, there's no timestamp check to reject old/replayed webhooks.

**Recommendation:** Check `event.created` and reject events older than a reasonable window (e.g., 5 minutes).

---

### INFO-07: Plaid Environment Fallback to Sandbox

**File:** `lib/plaid.ts` (lines 6, 16)  
**Description:** If `PLAID_ENV` is not set, the application defaults to `sandbox` mode. This is safe behavior but should be explicitly documented and logged on startup.

**Recommendation:** Log a warning on startup if Plaid is in sandbox mode in a deployed environment.

---

## Remediation Status

| ID | Finding | Status | Notes |
|----|---------|--------|-------|
| CRIT-01 | No RLS policies | **Mitigated** | RLS policies created in `docs/supabase-migration-rls-policies.sql`. Apply manually in Supabase SQL Editor. Service role key still bypasses RLS — migrate to user-scoped client with Clerk JWTs for full enforcement. |
| CRIT-03 | Plaid tokens in plaintext | **Requires infrastructure work** | Encrypt at rest using `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) with a key from a KMS (e.g. AWS KMS, Vault). Alternatively, use application-level AES-256-GCM encryption before writing to Supabase. The `.plaid-token.json` dev artifact should be removed and added to `.gitignore`. |
| CRIT-04 | Gmail tokens in plaintext | **Requires infrastructure work** | Same approach as CRIT-03: encrypt `access_token` and `refresh_token` columns in `gmail_connections` using `pgcrypto` or application-level encryption with a KMS-managed key. |
| CRIT-06 | `proxy.ts` not loaded as middleware | **Fixed** | Renamed to `middleware.ts`. |
| HIGH-01 | No rate limiting | **Fixed** | In-memory sliding window rate limiter applied to LLM, Plaid, receipt, Gmail, and demo routes. For production scale, migrate to Upstash Redis or Vercel Edge Config. |
| HIGH-06 | Demo mode on staging | **Fixed** | Demo mode now requires explicit `DEMO_ENABLED=true` env var in addition to `NODE_ENV !== "production"`. |
| HIGH-09 | `NEXT_PUBLIC_SKIP_AUTH` no production guard | **Fixed** | `AppGate.tsx` now ignores the flag when `NODE_ENV === "production"`. |
| MED-05 | `invite_token` exposed to all members | **Fixed** | Token is only returned for groups where the user is the owner. |
| MED-08 | `body.userId` accepted in member creation | **Fixed** | `user_id` is always set to `null` on creation; should only be linked via invite acceptance flow. |
| MED-09 | Open redirect in Gmail callback | **Fixed** | `coconut://` URLs restricted to an explicit allowlist of known deep link paths. |

---

## Recommended Integrations

| Tool | Purpose | Priority |
|------|---------|----------|
| **Sentry** | Error monitoring with PII scrubbing | Immediate |
| **Dependabot / Snyk** | Automated dependency vulnerability scanning | Immediate |
| **Upstash / Redis** | Rate limiting for API routes | Immediate |
| **GitHub CodeQL** | Static analysis for security vulnerabilities | Short-term |
| **Vercel WAF** | Web Application Firewall for common attacks | Short-term |
| **AWS KMS / Vault** | Secrets management for Plaid/Gmail tokens | Short-term |
| **zod** | Runtime input validation for all API routes | Immediate |
| **Arcjet** | Bot detection and rate limiting | Medium-term |
| **OWASP ZAP** | Automated penetration testing in CI | Medium-term |

---

## Remediation Roadmap

### Immediate (This Week)

| ID | Action | Effort | Impact |
|----|--------|--------|--------|
| CRIT-06 | Rename `proxy.ts` to `middleware.ts` | 15 min | Ensures Clerk middleware is active |
| CRIT-02 | Add `canAccessGroup()` to receipt finish route | 30 min | Fixes IDOR |
| HIGH-10 | Remove debug endpoints | 15 min | Reduces attack surface |
| HIGH-09 | Add runtime kill switch for SKIP_AUTH in production | 30 min | Prevents auth bypass |
| MED-05 | Remove `invite_token` from non-owner responses | 15 min | Limits token exposure |
| HIGH-05 | Validate member IDs against group in split routes | 30 min | Fixes IDOR |
| HIGH-04 | Verify user is settlement participant | 30 min | Fixes IDOR |

### Short-Term (1–2 Weeks)

| ID | Action | Effort | Impact |
|----|--------|--------|--------|
| CRIT-01 | Define RLS policies + create per-user Supabase client | 2–3 days | Defense-in-depth for all data |
| CRIT-05 | Validate group/member ownership in Stripe routes | 1 hour | Prevents settlement manipulation |
| HIGH-01 | Implement rate limiting on all endpoints | 1–2 days | Prevents cost attacks |
| HIGH-02 | Add file upload validation (type, size, magic bytes) | 1 hour | Prevents upload abuse |
| HIGH-07 | Sanitize all error responses to clients | 2 hours | Prevents info leakage |
| MED-01 | Add input length validation with zod | 1–2 days | Prevents storage/cost abuse |
| MED-04 | Add zod schema validation to all routes | 2 days | Comprehensive input safety |
| LOW-01 | Configure security headers in next.config.js | 1 hour | XSS/clickjacking protection |

### Long-Term (1 Month)

| ID | Action | Effort | Impact |
|----|--------|--------|--------|
| CRIT-03 | Encrypt Plaid tokens at rest | 1 day | Protects bank connections |
| CRIT-04 | Encrypt Gmail tokens at rest | 1 day | Protects email access |
| HIGH-03 | Implement prompt injection defenses | 2–3 days | Protects LLM features |
| HIGH-06 | Harden demo mode / remove from deployed builds | 2 hours | Eliminates auth bypass vector |
| HIGH-08 | Restrict split deletion to creator/owner + audit log | 1 hour | Prevents data destruction |
| MED-06 | Implement soft deletes + audit trail for settlements | 2 hours | Financial record integrity |
| MED-07 | Cryptographic OAuth state signing | 1 hour | Prevents OAuth attacks |
| INFO-01 | Set up Dependabot + Snyk | 1 hour | Ongoing vulnerability monitoring |
| INFO-02 | Integrate Sentry error monitoring | 2 hours | Production visibility |

---

## Appendix: Files Reviewed

### API Routes (50 files)
- `app/api/chat/route.ts`
- `app/api/demo/route.ts`
- `app/api/debug/me/route.ts`
- `app/api/email-receipts/route.ts`
- `app/api/gmail/auth/route.ts`
- `app/api/gmail/callback/route.ts`
- `app/api/gmail/debug-amazon/route.ts`
- `app/api/gmail/disconnect/route.ts`
- `app/api/gmail/scan/route.ts`
- `app/api/gmail/status/route.ts`
- `app/api/groups/route.ts`
- `app/api/groups/[id]/route.ts`
- `app/api/groups/[id]/listen/route.ts`
- `app/api/groups/[id]/members/route.ts`
- `app/api/groups/[id]/settlements/route.ts`
- `app/api/groups/people/route.ts`
- `app/api/groups/person/route.ts`
- `app/api/groups/recent-activity/route.ts`
- `app/api/groups/summary/route.ts`
- `app/api/groups/__tests__/route.test.ts`
- `app/api/groups/__tests__/route-smoke.test.ts`
- `app/api/manual-expense/route.ts`
- `app/api/manual-expense/__tests__/route.test.ts`
- `app/api/nl-parse/route.ts`
- `app/api/nl-search/route.ts`
- `app/api/plaid/accounts/route.ts`
- `app/api/plaid/create-link-token/route.ts`
- `app/api/plaid/disconnect/route.ts`
- `app/api/plaid/exchange-token/route.ts`
- `app/api/plaid/status/route.ts`
- `app/api/plaid/transactions/route.ts`
- `app/api/plaid/wipe/route.ts`
- `app/api/plaid/__tests__/accounts-dedup.test.ts`
- `app/api/plaid/__tests__/disconnect.test.ts`
- `app/api/receipt/parse/route.ts`
- `app/api/receipt/[id]/assign/route.ts`
- `app/api/receipt/[id]/finish/route.ts`
- `app/api/receipt/[id]/items/route.ts`
- `app/api/search/route.ts`
- `app/api/settlements/route.ts`
- `app/api/split-transactions/route.ts`
- `app/api/split-transactions/[id]/route.ts`
- `app/api/stripe/create-payment-link/route.ts`
- `app/api/stripe/terminal/connection-token/route.ts`
- `app/api/stripe/terminal/create-payment-intent/route.ts`
- `app/api/stripe/terminal/location/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/api/stripe/terminal/__tests__/routes.test.ts`
- `app/api/subscriptions/route.ts`
- `app/api/subscriptions/[id]/route.ts`

### Library Files (38 files)
- `lib/auth.ts`
- `lib/config.ts`
- `lib/currency.ts`
- `lib/data.ts`
- `lib/demo.ts`
- `lib/expense-shares.ts`
- `lib/google-auth.ts`
- `lib/group-access.ts`
- `lib/group-balances.ts`
- `lib/merchant-display.ts`
- `lib/merchant-logos.ts`
- `lib/merchant-normalize-llm.ts`
- `lib/nl-query.ts`
- `lib/openai.ts`
- `lib/plaid.ts`
- `lib/plaid-client.ts`
- `lib/plaid-mappers.ts`
- `lib/receipt-matcher.ts`
- `lib/receipt-ocr.ts`
- `lib/receipt-parser.ts`
- `lib/receipt-pdf.ts`
- `lib/receipt-split.ts`
- `lib/receipt-split.test.ts`
- `lib/search.ts`
- `lib/search-engine.ts`
- `lib/split-balances.ts`
- `lib/split-balances.test.ts`
- `lib/subscription-config.ts`
- `lib/subscription-detect.ts`
- `lib/supabase.ts`
- `lib/transaction-sync.ts`
- `lib/transaction-types.ts`
- `lib/types.ts`
- `lib/__tests__/expense-shares.test.ts`
- `lib/__tests__/merchant-display.test.ts`
- `lib/__tests__/merchant-logos.test.ts`
- `lib/__tests__/transaction-dedup.test.ts`
- `lib/__tests__/transaction-filters.test.ts`

### Components & Hooks
- `components/AppGate.tsx`
- `hooks/useAccounts.ts`
- `hooks/useGmail.ts`
- `hooks/useGroupListen.ts`
- `hooks/useGroups.ts`
- `hooks/useHiddenAccounts.ts`
- `hooks/useNLParse.ts`
- `hooks/useNLSearch.ts`
- `hooks/usePullToRefresh.ts`
- `hooks/useReceiptSplit.ts`
- `hooks/useSubscriptions.ts`
- `hooks/useTransactions.ts`

### Infrastructure & Config
- `proxy.ts` (Clerk middleware)
- `next.config.js`
- `package.json`
- `package-lock.json`
- `.env.example`

### Database Schema & Migrations
- `docs/supabase-schema.sql`
- `docs/supabase-migration-splitwise-parity.sql`
- `docs/supabase-migration-accounts-balance.sql`
- `docs/supabase-migration-gmail-receipts.sql`
- `docs/supabase-fix-date-column.sql`
- `docs/supabase-migration-receipt-split.sql`
- `docs/supabase-migration-receipt-other-fees.sql`
- `docs/supabase-realtime-enable.sql`
- `docs/supabase-migration-split-unique.sql`
