import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Returns a Supabase client using the **service role key**.
 * This bypasses Row Level Security — only use for operations that
 * genuinely need cross-user access (webhooks, background jobs, etc.).
 *
 * SECURITY NOTE: The service role key has unrestricted access to every
 * row in every table. RLS policies exist (see docs/supabase-migration-rls-policies.sql)
 * but are only enforced when using the anon key with a user JWT.
 * For user-facing API routes, prefer {@link getSupabaseForUser} when you have
 * a Clerk session token so RLS can enforce row-level access.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!url || !serviceKey)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Returns a Supabase client that uses the **anon key** and the given Clerk JWT.
 * When Supabase is configured to verify Clerk's JWT (Dashboard → Settings → API →
 * JWT Secret = Clerk's JWT signing key), RLS policies will enforce access by
 * clerk_user_id (via requesting_user_id() in policies).
 *
 * Use in API routes: get the token with `await auth().getToken()` and pass it here.
 * If token or anon key is missing, returns null — caller should use getSupabaseAdmin()
 * and enforce clerk_user_id in application code.
 */
export function getSupabaseForUser(accessToken: string | null): SupabaseClient | null {
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

/** @deprecated Use {@link getSupabaseAdmin} (explicit name) */
export const getSupabase = getSupabaseAdmin;
