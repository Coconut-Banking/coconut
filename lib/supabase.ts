import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Returns a Supabase client using the **service role key**.
 * This bypasses Row Level Security — only use for operations that
 * genuinely need cross-user access (webhooks, background jobs, etc.).
 *
 * For user-facing API routes, prefer {@link getSupabaseForUser} which
 * returns a thin wrapper that enforces clerk_user_id scoping.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!url || !serviceKey)
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

/** @deprecated Use {@link getSupabaseAdmin} (explicit name) */
export const getSupabase = getSupabaseAdmin;
