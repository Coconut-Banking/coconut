import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    // In development without a key, return plaintext (don't break local dev)
    return Buffer.alloc(0);
  }
  // Support both raw hex keys and base64 keys
  const buf = key.length === 64 ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 256 bits (32 bytes)");
  }
  return buf;
}

/**
 * Encrypt a plaintext string. Returns base64-encoded ciphertext with IV and auth tag prepended.
 * If no encryption key is configured, returns the plaintext as-is (for local development).
 */
let warnedMissingKey = false;

export function encryptToken(plaintext: string): string {
  const key = getKey();
  if (key.length === 0) {
    if (process.env.NODE_ENV === "production" && !warnedMissingKey) {
      console.warn("[encryption] WARNING: TOKEN_ENCRYPTION_KEY is not set — tokens are stored in plaintext. Set this env var to enable AES-256-GCM encryption.");
      warnedMissingKey = true;
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a token. Accepts both encrypted (base64) and plaintext values
 * for backwards compatibility during migration.
 */
export function decryptToken(value: string): string {
  const key = getKey();
  if (key.length === 0) return value;

  // Try to detect if the value is actually encrypted (base64) or plaintext
  // Encrypted values are always valid base64 and at least IV_LENGTH + TAG_LENGTH bytes
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return value; // Not base64 — plaintext token (pre-migration)
  }

  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    return value; // Too short to be encrypted — plaintext token
  }

  try {
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    // Decryption failed — likely a plaintext token from before encryption was enabled
    return value;
  }
}
