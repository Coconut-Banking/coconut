/**
 * CI workflow (.github/workflows/ci.yml) sets CLERK_SECRET_KEY to a placeholder.
 * Clerk's API and handshake verification reject it, so flows that rely on real
 * Clerk behavior must be skipped unless repo secrets supply matching test keys.
 */
export function isPlaceholderClerkSecret(): boolean {
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  return secret.trim() === "" || /placeholder/i.test(secret);
}
