import { auth } from "@clerk/nextjs/server";

const SKIP_AUTH =
  process.env.NODE_ENV !== "production" &&
  String(process.env.SKIP_AUTH ?? "").trim().toLowerCase() === "true";

/** Fixed dev user used when SKIP_AUTH — same ID every time, no config needed */
const DEV_SKIP_AUTH_USER_ID = "dev_skip_auth_user";

export class ClerkRateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super("Clerk rate limited");
    this.name = "ClerkRateLimitError";
    this.retryAfter = retryAfter;
  }
}

function isClerkRateLimitError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return err.clerkError === true && (err.status === 429 || err.code === "api_response_error");
}

/**
 * Get the current user ID. When SKIP_AUTH is true and no token,
 * returns a fixed dev user ID so testing always works without auth.
 * Throws ClerkRateLimitError when Clerk returns 429.
 */
export async function getUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    if (userId) return userId;
  } catch (e) {
    if (isClerkRateLimitError(e)) {
      throw new ClerkRateLimitError((e as { retryAfter?: number }).retryAfter ?? 5);
    }
    throw e;
  }

  if (!SKIP_AUTH) return null;

  return DEV_SKIP_AUTH_USER_ID;
}
