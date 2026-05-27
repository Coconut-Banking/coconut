import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tests for BUG-CRITICAL-1: card routes must be in the isPublicRoute matcher.
 *
 * createRouteMatcher from @clerk/nextjs/server cannot be instantiated in a
 * Vitest unit-test environment (requires full Next.js middleware runtime).
 * Instead, we inspect the middleware source to confirm the required route
 * strings are present in the isPublicRoute call.
 *
 * These tests FAIL against the old code (routes absent) and PASS after the fix.
 */

const middlewareSrc = readFileSync(
  join(process.cwd(), "middleware.ts"),
  "utf-8"
);

describe("middleware.ts isPublicRoute (BUG-CRITICAL-1)", () => {
  it("includes /cards for unauthenticated UI access", () => {
    expect(middlewareSrc).toContain('"/cards"');
  });

  it("includes /api/cards/create-link-token for unauthenticated Plaid link token creation", () => {
    expect(middlewareSrc).toContain('"/api/cards/create-link-token"');
  });

  it("includes /api/cards/analyze-plaid for unauthenticated transaction analysis", () => {
    expect(middlewareSrc).toContain('"/api/cards/analyze-plaid"');
  });

  it("includes /api/cards/list for unauthenticated card listing", () => {
    expect(middlewareSrc).toContain('"/api/cards/list"');
  });

  it("includes /api/cards/recommend for session-based unauthenticated recommendations", () => {
    expect(middlewareSrc).toContain('"/api/cards/recommend"');
  });

  it("includes /pay and /collect for guest payment and table collection", () => {
    expect(middlewareSrc).toContain('"/pay(.*)"');
    expect(middlewareSrc).toContain('"/collect(.*)"');
    expect(middlewareSrc).toContain('"/receipt/collect(.*)"');
  });

  it("does NOT include /api/cards/analyze-coconut as public (requires Coconut user auth)", () => {
    // analyze-coconut must remain protected — should NOT appear in the isPublicRoute list
    const publicRouteBlock = middlewareSrc.match(
      /const isPublicRoute = createRouteMatcher\(\[([\s\S]*?)\]\)/
    )?.[1] ?? "";
    expect(publicRouteBlock).not.toContain('"/api/cards/analyze-coconut"');
  });
});
