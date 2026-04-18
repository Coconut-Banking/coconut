/**
 * Tests for the res.ok check pattern (Pattern #5).
 *
 * Background: Without checking res.ok before calling .json(), a non-2xx response
 * that returns an HTML error page (e.g. a 500 from Next.js) causes JSON.parse to
 * throw a SyntaxError. The error is still caught downstream, but the real HTTP
 * status is masked — making debugging much harder.
 *
 * This file documents the correct pattern and proves the failure mode.
 */

import { describe, it, expect } from "vitest";

/** Simulates the BUGGY pattern: no res.ok check before .json() */
async function fetchCardsListBuggy(mockFetch: () => Promise<Response>): Promise<{ cards: unknown[] }> {
  const r = await mockFetch();
  return r.json() as Promise<{ cards: unknown[] }>;
}

/** Simulates the FIXED pattern: check res.ok before .json() */
async function fetchCardsListFixed(mockFetch: () => Promise<Response>): Promise<{ cards: unknown[] }> {
  const r = await mockFetch();
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json() as Promise<{ cards: unknown[] }>;
}

/** Creates a mock Response with an HTML body (what Next.js returns on error pages) */
function makeHtmlErrorResponse(status: number): Response {
  return new Response(
    `<!DOCTYPE html><html><body><h1>${status} Internal Server Error</h1></body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html" },
    }
  );
}

/** Creates a mock successful JSON response */
function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetch res.ok pattern (Pattern #5)", () => {
  it("buggy pattern: HTML 500 response causes SyntaxError from .json()", async () => {
    const mockFetch = () => Promise.resolve(makeHtmlErrorResponse(500));

    // Without the ok check, .json() on an HTML body throws a SyntaxError
    await expect(fetchCardsListBuggy(mockFetch)).rejects.toThrow(SyntaxError);
  });

  it("fixed pattern: HTML 500 response throws a clear HTTP error before .json()", async () => {
    const mockFetch = () => Promise.resolve(makeHtmlErrorResponse(500));

    // With the ok check, we get a descriptive HTTP error, not a parse error
    await expect(fetchCardsListFixed(mockFetch)).rejects.toThrow("HTTP 500");
  });

  it("fixed pattern: HTML 503 response throws HTTP 503", async () => {
    const mockFetch = () => Promise.resolve(makeHtmlErrorResponse(503));

    await expect(fetchCardsListFixed(mockFetch)).rejects.toThrow("HTTP 503");
  });

  it("fixed pattern: HTML 404 response throws HTTP 404", async () => {
    const mockFetch = () => Promise.resolve(makeHtmlErrorResponse(404));

    await expect(fetchCardsListFixed(mockFetch)).rejects.toThrow("HTTP 404");
  });

  it("fixed pattern: successful 200 JSON response parses correctly", async () => {
    const payload = { cards: [{ id: "c1", name: "Test Card" }] };
    const mockFetch = () => Promise.resolve(makeJsonResponse(payload));

    const result = await fetchCardsListFixed(mockFetch);
    expect(result).toEqual(payload);
  });

  it("buggy pattern: successful 200 JSON response also parses correctly (no regression)", async () => {
    const payload = { cards: [{ id: "c1", name: "Test Card" }] };
    const mockFetch = () => Promise.resolve(makeJsonResponse(payload));

    const result = await fetchCardsListBuggy(mockFetch);
    expect(result).toEqual(payload);
  });
});
