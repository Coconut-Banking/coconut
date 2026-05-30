import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const store = new Map<string, number[]>();

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, timestamps] of store) {
    const valid = timestamps.filter((t) => t > now - windowMs);
    if (valid.length === 0) store.delete(key);
    else store.set(key, valid);
  }
}

/** In-memory rate limit (per serverless instance). */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { success: boolean; remaining: number } {
  cleanup(windowMs);
  const now = Date.now();
  const timestamps = (store.get(key) ?? []).filter((t) => t > now - windowMs);
  if (timestamps.length >= limit) {
    return { success: false, remaining: 0 };
  }
  timestamps.push(now);
  store.set(key, timestamps);
  return { success: true, remaining: limit - timestamps.length };
}

/**
 * Distributed rate limit when UPSTASH_REDIS_REST_URL + TOKEN are set.
 * Falls back to in-memory rateLimit otherwise.
 */
export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ success: boolean; remaining: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return rateLimit(key, limit, windowMs);
  }

  try {
    const redis = new Redis({ url, token });
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: "coconut-rl",
    });
    const { success, remaining } = await ratelimit.limit(key);
    return { success, remaining: remaining ?? 0 };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[rate-limit] Upstash failed, using in-memory fallback", e);
    }
    return rateLimit(key, limit, windowMs);
  }
}
