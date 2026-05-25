import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getAppUrl } from "./app-url";

/** Signed pay-link payload — no server-side storage required. */
export type PayLinkPayload = {
  v: 1;
  groupId: string;
  payerMemberId: string;
  receiverMemberId: string;
  /** Settlement amount in major currency units (e.g. dollars). */
  amount: number;
  currency: string;
  /** Unix timestamp (ms) when the link expires. */
  exp: number;
  nonce: string;
};

export const PAY_LINK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getHmacKey(): string {
  const key =
    process.env.PAY_LINK_SIGNING_KEY ||
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error(
      "PAY_LINK_SIGNING_KEY (or TOKEN_ENCRYPTION_KEY / CLERK_SECRET_KEY) must be set",
    );
  }
  return key;
}

function signPayload(encoded: string): string {
  return createHmac("sha256", getHmacKey()).update(encoded).digest("base64url");
}

export function createPayLinkToken(
  input: Omit<PayLinkPayload, "v" | "exp" | "nonce"> & { exp?: number },
): string {
  const payload: PayLinkPayload = {
    v: 1,
    groupId: input.groupId,
    payerMemberId: input.payerMemberId,
    receiverMemberId: input.receiverMemberId,
    amount: Math.round(input.amount * 100) / 100,
    currency: input.currency.toUpperCase(),
    exp: input.exp ?? Date.now() + PAY_LINK_MAX_AGE_MS,
    nonce: randomBytes(12).toString("base64url"),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

export function verifyPayLinkToken(
  token: string,
): { valid: true; payload: PayLinkPayload } | { valid: false; reason: string } {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { valid: false, reason: "invalid_format" };

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(encoded);

  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { valid: false, reason: "invalid_signature" };
  }

  let payload: PayLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PayLinkPayload;
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }

  if (payload.v !== 1) return { valid: false, reason: "unsupported_version" };
  if (!payload.groupId || !payload.payerMemberId || !payload.receiverMemberId) {
    return { valid: false, reason: "missing_fields" };
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return { valid: false, reason: "invalid_amount" };
  }
  if (Date.now() > payload.exp) return { valid: false, reason: "expired" };

  return { valid: true, payload };
}

export function payLinkPublicUrl(token: string): string {
  return `${getAppUrl()}/pay/${encodeURIComponent(token)}`;
}
