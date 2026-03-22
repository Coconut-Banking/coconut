# Plaid “can’t link bank” (web / connect)

Related: [GitHub issue #99](https://github.com/Coconut-Banking/coconut/issues/99).

## Most common causes

### 1. In-app browser (Telegram, Instagram, etc.)

Embedded browsers often **block or isolate cookies**, so you look “signed in” on screen but `/api/plaid/*` requests return **401** or Plaid never completes OAuth.

**Fix:** Open the same URL in **Safari** or **Chrome** (Share → Open in Browser), sign in again, then connect the bank.

### 2. Session not ready (401 on `create-link-token`)

Symptoms: “Your session isn’t ready yet” / `create-link-token returned 401`.

**Fix:** Use **Sign in again** on the error card, or open `/login` and return to `/connect`.

### 3. Plaid redirect URI mismatch

OAuth banks need an exact redirect URI registered in the **Plaid Dashboard** for your environment:

- Production: `https://<your-production-domain>/connect`  
  (must match `APP_URL` on Vercel, e.g. `https://coconut-app.dev` → `https://coconut-app.dev/connect`)

**Fix:** Plaid Dashboard → Team → **API** → **Allowed redirect URIs** → add the URI above.

### 4. Plaid not configured (503)

**Fix:** Set `PLAID_CLIENT_ID` and `PLAID_SECRET` / `PLAID_SANDBOX_SECRET` (or production secret) in Vercel env for the deployed app.

### 5. Duplicate bank (409)

Message: “You already have this bank linked…”

**Fix:** Settings → **Fix connection** (re-auth), don’t add the same institution again.

### 6. `exchange-token` 500 after Link succeeds (encryption key)

Symptoms: Plaid **Link completes** (`link_success` in logs) then **`/api/plaid/exchange-token`** returns **500**.  
Vercel logs show: `inner_message: 'TOKEN_ENCRYPTION_KEY must be 256 bits (32 bytes)'`.

**Cause:** `TOKEN_ENCRYPTION_KEY` is missing, too short, or not in the expected format. The server must encrypt Plaid access tokens before saving to the database.

**Fix (Vercel / production):**

1. Generate a key (pick one):
   - `openssl rand -hex 32` → **64 hex characters** (paste as-is)
   - or `openssl rand -base64 32` → paste the **full** base64 string
2. In Vercel → Project → **Settings** → **Environment Variables**, set **`TOKEN_ENCRYPTION_KEY`** for **Production** (and Preview if you use it).
3. **Redeploy** so the new env is applied.

**Note:** Changing this key later will make **existing** encrypted tokens in the DB unreadable — users may need to **re-link** banks. Webhooks may log `item not found` until the item row exists (normal if exchange never saved).

## What to send when reporting

- `trace_id` from the red error box on `/connect`
- Whether you used **Telegram / in-app browser** vs **Safari**
- Approximate time (for server log correlation)
