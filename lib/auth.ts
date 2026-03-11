import { auth } from "@clerk/nextjs/server";

const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  String(process.env.SKIP_AUTH ?? "").trim().toLowerCase() === "true";

/** Fixed dev user used when SKIP_AUTH — same ID every time, no config needed */
const DEV_SKIP_AUTH_USER_ID = "dev_skip_auth_user";

/**
 * Get the current user ID. When SKIP_AUTH is true and no token,
 * returns a fixed dev user ID so testing always works without auth.
 */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  if (userId) return userId;

  if (!SKIP_AUTH) return null;

  return DEV_SKIP_AUTH_USER_ID;
}
