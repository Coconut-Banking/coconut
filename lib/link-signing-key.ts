/**
 * Resolves HMAC keys for signed pay/collect links.
 * Production must not fall back to CLERK_SECRET_KEY (rotation would invalidate links).
 */

export function resolveLinkSigningKey(
  dedicatedEnv: string | undefined,
  fallbackEnvNames: Array<"TOKEN_ENCRYPTION_KEY" | "CLERK_SECRET_KEY">,
): string {
  const dedicated = dedicatedEnv?.trim();
  if (dedicated) return dedicated;

  const isProduction = process.env.NODE_ENV === "production";

  for (const name of fallbackEnvNames) {
    if (isProduction && name === "CLERK_SECRET_KEY") continue;
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  const hint = isProduction
    ? "Set PAY_LINK_SIGNING_KEY / COLLECT_LINK_SIGNING_KEY or TOKEN_ENCRYPTION_KEY in production"
    : "Set PAY_LINK_SIGNING_KEY or TOKEN_ENCRYPTION_KEY / CLERK_SECRET_KEY for local dev";
  throw new Error(`Link signing key missing. ${hint}`);
}
