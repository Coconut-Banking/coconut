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

export function isClerkRateLimitError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.clerkError === true &&
    (err.status === 429 || err.code === "api_response_error")
  );
}

let _clerkRateLimitedUntil = 0;

function checkClerkRateLimit(): void {
  const now = Date.now();
  if (now < _clerkRateLimitedUntil) {
    const remaining = Math.ceil((_clerkRateLimitedUntil - now) / 1000);
    throw new ClerkRateLimitError(remaining);
  }
}

function markClerkRateLimited(retryAfter: number): void {
  _clerkRateLimitedUntil = Date.now() + Math.max(retryAfter, 3) * 1000;
}

/**
 * Get the current user ID. When SKIP_AUTH is true and no token,
 * returns a fixed dev user ID so testing always works without auth.
 * Returns null (not throw) when Clerk is rate-limited — callers
 * already handle null as 401 Unauthorized, which is safe.
 */
export async function getUserId(): Promise<string | null> {
  if (Date.now() < _clerkRateLimitedUntil) {
    console.warn("[auth] Clerk rate-limited, returning null");
    return null;
  }

  try {
    const { userId } = await auth();
    if (userId) return userId;
  } catch (e) {
    if (isClerkRateLimitError(e)) {
      const retryAfter = (e as { retryAfter?: number }).retryAfter ?? 5;
      markClerkRateLimited(retryAfter);
      console.warn(`[auth] Clerk 429 (retry ${retryAfter}s), returning null`);
      return null;
    }
    throw e;
  }

  if (!SKIP_AUTH) return null;

  return DEV_SKIP_AUTH_USER_ID;
}

export function isClerkCurrentlyRateLimited(): boolean {
  return Date.now() < _clerkRateLimitedUntil;
}

export { checkClerkRateLimit, markClerkRateLimited };
