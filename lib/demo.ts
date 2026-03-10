import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";

export const DEMO_USER_ID = "demo-sandbox-user";
export const DEMO_COOKIE = "coconut_demo_mode";

export const DEMO_PROFILE = {
  firstName: "Alex",
  lastName: "Demo",
  fullName: "Alex Demo",
  email: "alex@coconut-demo.com",
};

/**
 * Returns true when the current request is in demo mode (cookie set).
 * Works in server components and API routes.
 */
export async function isDemoMode(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(DEMO_COOKIE)?.value === "true";
}

/**
 * Returns the effective user ID for API routes:
 * - If authenticated via Clerk, returns the real userId (never demo)
 * - If in demo mode (cookie), returns DEMO_USER_ID
 * - Otherwise returns null (unauthenticated, no demo)
 */
export async function getEffectiveUserId(): Promise<string | null> {
  const { userId } = await auth();
  if (userId) return userId;
  if (process.env.NODE_ENV !== "production" && (await isDemoMode()))
    return DEMO_USER_ID;
  return null;
}
