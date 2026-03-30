import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export const DEMO_USER_ID = "demo-sandbox-user";
export const DEMO_COOKIE = "coconut_demo_mode";

export const DEMO_PROFILE = {
  firstName: "Alex",
  lastName: "Demo",
  fullName: "Alex Demo",
  email: "alex@coconut-demo.com",
};

function isDemoEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEMO_ENABLED === "true"
  );
}

/**
 * Returns true when the current request is in demo mode (cookie set).
 * Works in server components and API routes.
 * Requires both NODE_ENV !== "production" and DEMO_ENABLED=true.
 */
export async function isDemoMode(): Promise<boolean> {
  if (!isDemoEnabled()) return false;
  const jar = await cookies();
  return jar.get(DEMO_COOKIE)?.value === "true";
}

/** Default user when CLERK_DISABLED and plaid_items is empty — lets you link first bank without any config. */
const CLERK_BYPASS_DEFAULT_ID = "clerk_disabled_default_user";

/**
 * When CLERK_DISABLED, return fallback user: AUTH_BYPASS_USER_ID, first in plaid_items, or default.
 */
async function getClerkBypassUserId(): Promise<string | null> {
  const override = process.env.AUTH_BYPASS_USER_ID?.trim();
  if (override) return override;
  const db = getSupabase();
  const { data } = await db.from("plaid_items").select("clerk_user_id").limit(1);
  return data?.[0]?.clerk_user_id ?? CLERK_BYPASS_DEFAULT_ID;
}

/**
 * Returns the effective user ID for API routes:
 * - If authenticated via Clerk, returns the real userId (never demo)
 * - If CLERK_DISABLED and no Clerk session, returns AUTH_BYPASS_USER_ID or first plaid user
 * - If in demo mode (cookie + env guard), returns DEMO_USER_ID
 * - Otherwise returns null (unauthenticated, no demo)
 */
export async function getEffectiveUserId(): Promise<string | null> {
  const { userId } = await auth();
  if (userId) return userId;

  if (process.env.CLERK_DISABLED === "true" && process.env.NODE_ENV !== "production") {
    return getClerkBypassUserId();
  }

  if (await isDemoMode()) return DEMO_USER_ID;
  return null;
}
