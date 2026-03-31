import { cache } from "react";
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

function markClerkRateLimited(retryAfter: number): void {
  _clerkRateLimitedUntil = Date.now() + Math.max(retryAfter, 3) * 1000;
}

type ClerkAuthSnapshot = Awaited<ReturnType<typeof auth>>;

/**
 * One Clerk `auth()` per incoming request (dedupes multiple callers in the same
 * route/module tree). Pair with `getEffectiveUserId({ userId })` instead of a
 * second bare `auth()` + `getEffectiveUserId()` to cut Backend API traffic.
 */
export type LoadClerkAuthResult =
  | { ok: true; userId: string | null; getToken: ClerkAuthSnapshot["getToken"] }
  | { ok: false; reason: "rate_limited" };

export const loadClerkAuth = cache(async (): Promise<LoadClerkAuthResult> => {
  // auth() reads from the middleware-computed request context — it does NOT hit
  // Clerk's Backend API, so it is safe to call even during a rate-limit window.
  // Only getToken() makes an outbound API call; callers should handle that failure.
  try {
    const a = await auth();
    return { ok: true, userId: a.userId ?? null, getToken: a.getToken };
  } catch (e) {
    if (isClerkRateLimitError(e)) {
      const retryAfter = (e as { retryAfter?: number }).retryAfter ?? 5;
      markClerkRateLimited(retryAfter);
      return { ok: false, reason: "rate_limited" };
    }
    throw e;
  }
});

/**
 * Get the current user ID. When SKIP_AUTH is true and no token,
 * returns a fixed dev user ID so testing always works without auth.
 * Returns null (not throw) when Clerk is rate-limited — callers
 * already handle null as 401 Unauthorized, which is safe.
 */
export async function getUserId(): Promise<string | null> {
  const r = await loadClerkAuth();
  if (!r.ok) {
    console.warn("[auth] Clerk rate-limited, returning null");
    return null;
  }
  if (r.userId) return r.userId;

  if (!SKIP_AUTH) return null;

  return DEV_SKIP_AUTH_USER_ID;
}

export function isClerkCurrentlyRateLimited(): boolean {
  return Date.now() < _clerkRateLimitedUntil;
}

/** Seconds until local Clerk backoff ends (for Retry-After headers). */
export function getClerkRateLimitRetryAfterSeconds(): number {
  return Math.max(1, Math.ceil((_clerkRateLimitedUntil - Date.now()) / 1000));
}

const _supabaseTokenCacheByUser = new Map<string, { token: string; expiresAt: number }>();
const SUPABASE_TOKEN_CACHE_TTL_MS = 50_000;

/**
 * Wraps getToken({ template: "supabase" }) with an in-memory cache so
 * concurrent requests to the same serverless instance share one token
 * instead of each hitting Clerk's Backend API. The cache is keyed by
 * userId to prevent cross-user data leaks on warm serverless instances.
 * Returns null on failure.
 */
export async function getCachedSupabaseToken(
  getToken: ClerkAuthSnapshot["getToken"],
  userId: string
): Promise<string | null> {
  const now = Date.now();
  const cached = _supabaseTokenCacheByUser.get(userId);
  if (cached && now < cached.expiresAt) {
    return cached.token;
  }
  if (now < _clerkRateLimitedUntil) return cached?.token ?? null;
  try {
    const token = await getToken({ template: "supabase" });
    if (token) {
      _supabaseTokenCacheByUser.set(userId, { token, expiresAt: now + SUPABASE_TOKEN_CACHE_TTL_MS });
    }
    return token;
  } catch (e) {
    if (e instanceof ClerkRateLimitError || isClerkRateLimitError(e)) {
      const ra = e instanceof ClerkRateLimitError
        ? e.retryAfter
        : (e as { retryAfter?: number }).retryAfter ?? 5;
      markClerkRateLimited(ra);
    }
    return cached?.token ?? null;
  }
}

export { markClerkRateLimited };
