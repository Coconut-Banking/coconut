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
