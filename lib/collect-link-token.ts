import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getAppUrl } from "./app-url";

export type CollectLinkPayload = {
  v: 1;
  sessionId: string;
  exp: number;
  nonce: string;
};

export const COLLECT_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getHmacKey(): string {
  const key =
    process.env.COLLECT_LINK_SIGNING_KEY ||
    process.env.PAY_LINK_SIGNING_KEY ||
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error("COLLECT_LINK_SIGNING_KEY or PAY_LINK_SIGNING_KEY must be set");
  }
  return key;
}

function signPayload(encoded: string): string {
  return createHmac("sha256", getHmacKey()).update(encoded).digest("base64url");
}

export function createCollectLinkToken(sessionId: string, exp?: number): string {
  const payload: CollectLinkPayload = {
    v: 1,
    sessionId,
    exp: exp ?? Date.now() + COLLECT_LINK_MAX_AGE_MS,
    nonce: randomBytes(12).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

export function verifyCollectLinkToken(
  token: string,
): { valid: true; payload: CollectLinkPayload } | { valid: false; reason: string } {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { valid: false, reason: "invalid_format" };
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(encoded);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { valid: false, reason: "invalid_signature" };
  }
  let payload: CollectLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CollectLinkPayload;
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
  if (payload.v !== 1 || !payload.sessionId) return { valid: false, reason: "missing_fields" };
  if (Date.now() > payload.exp) return { valid: false, reason: "expired" };
  return { valid: true, payload };
}

export function collectPublicUrl(token: string, kind: "collect" | "receipt/collect"): string {
  return `${getAppUrl()}/${kind}/${encodeURIComponent(token)}`;
}
