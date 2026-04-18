/**
 * Unit tests for the auto-open Plaid Link guard logic.
 *
 * The full component cannot be rendered in a Vitest environment because
 * `react-plaid-link` (usePlaidLink) requires a real DOM Plaid iframe,
 * Clerk auth context, and Supabase. Instead we test the guard condition
 * logic in isolation — the same predicate used inside the useEffect.
 *
 * Bug: BUG-ONBOARD-1 — `if (step === "connected") return;` guard was
 * removed, allowing Plaid Link to open over the "Bank connected" screen
 * when migration completes and the link-token fetch resolves in parallel.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirrors the guard logic extracted from the auto-open useEffect in
 * app/connect/page.tsx:
 *
 *   if (step === "connected") return;               // ← BUG-ONBOARD-1 guard
 *   if (!linkToken || !ready || hasAutoOpened) return;
 *   if (receivedRedirectUri || fromApp) { open(); }
 *
 * Returns true when open() would be called.
 */
function wouldAutoOpen({
  step,
  linkToken,
  ready,
  hasAutoOpened,
  receivedRedirectUri,
  fromApp,
}: {
  step: string;
  linkToken: string | null;
  ready: boolean;
  hasAutoOpened: boolean;
  receivedRedirectUri: string | null;
  fromApp: boolean;
}): boolean {
  if (step === "connected") return false;
  if (!linkToken || !ready || hasAutoOpened) return false;
  if (receivedRedirectUri || fromApp) return true;
  return false;
}

describe("auto-open Plaid Link guard (BUG-ONBOARD-1)", () => {
  const BASE = {
    linkToken: "link-sandbox-abc",
    ready: true,
    hasAutoOpened: false,
    receivedRedirectUri: null,
    fromApp: true,
  };

  it("does NOT open when step is 'connected'", () => {
    expect(wouldAutoOpen({ ...BASE, step: "connected" })).toBe(false);
  });

  it("DOES open when step is 'idle' and fromApp is true", () => {
    expect(wouldAutoOpen({ ...BASE, step: "idle" })).toBe(true);
  });

  it("does NOT open when linkToken is missing", () => {
    expect(wouldAutoOpen({ ...BASE, step: "idle", linkToken: null })).toBe(false);
  });

  it("does NOT open when ready is false", () => {
    expect(wouldAutoOpen({ ...BASE, step: "idle", ready: false })).toBe(false);
  });

  it("does NOT open when hasAutoOpened is already true", () => {
    expect(wouldAutoOpen({ ...BASE, step: "idle", hasAutoOpened: true })).toBe(false);
  });

  it("DOES open when step is 'idle' and receivedRedirectUri is set", () => {
    expect(
      wouldAutoOpen({ ...BASE, step: "idle", fromApp: false, receivedRedirectUri: "https://example.com/oauth" })
    ).toBe(true);
  });

  it("does NOT open when step is 'connected' even if receivedRedirectUri is set", () => {
    expect(
      wouldAutoOpen({ ...BASE, step: "connected", receivedRedirectUri: "https://example.com/oauth" })
    ).toBe(false);
  });

  it("does NOT open when neither fromApp nor receivedRedirectUri", () => {
    expect(
      wouldAutoOpen({ ...BASE, step: "idle", fromApp: false, receivedRedirectUri: null })
    ).toBe(false);
  });
});
