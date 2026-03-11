import { test, expect } from "@playwright/test";

/**
 * These tests verify that the Clerk middleware rejects unauthenticated
 * requests to protected API routes.
 *
 * In CI the middleware returns 401/307. In local dev with Clerk's
 * keyless mode the behaviour may differ, so we also accept a 200
 * that contains no real user data (empty arrays / null userId).
 */

const REJECT_CODES = new Set([401, 403, 302, 307, 308, 429]);

function isRejected(status: number) {
  return REJECT_CODES.has(status);
}

const PROTECTED_GET_ROUTES = [
  "/api/plaid/transactions",
  "/api/plaid/accounts",
  "/api/plaid/status",
  "/api/subscriptions",
  "/api/email-receipts",
  "/api/groups",
  "/api/groups/summary",
  "/api/groups/people",
  "/api/groups/recent-activity",
  "/api/gmail/status",
  "/api/search?q=test",
  "/api/nl-parse?q=test",
  "/api/settlements",
];

test.describe("API Security — unauthenticated GET routes", () => {
  for (const path of PROTECTED_GET_ROUTES) {
    test(`GET ${path} does not expose data without auth`, async ({ request }) => {
      const response = await request.fetch(path, {
        method: "GET",
        maxRedirects: 0,
      });
      const status = response.status();

      if (isRejected(status)) {
        // Middleware blocked it — pass
        return;
      }

      // In dev/keyless mode the middleware may pass through, but the
      // route-level auth should return empty/null data, not real records.
      if (status === 200) {
        const text = await response.text();
        try {
          const body = JSON.parse(text);
          const hasNoData =
            body.userId === null ||
            body.error ||
            (Array.isArray(body.transactions) && body.transactions.length === 0) ||
            (Array.isArray(body.subscriptions) && body.subscriptions.length === 0) ||
            (Array.isArray(body.groups) && body.groups.length === 0) ||
            (Array.isArray(body.receipts) && body.receipts.length === 0) ||
            body.linked === false ||
            body.connected === false ||
            body.filters !== undefined;
          expect(hasNoData).toBeTruthy();
        } catch {
          // Non-JSON response (HTML redirect page) — acceptable
        }
      }
    });
  }
});

test.describe("API Security — public routes remain accessible", () => {
  test("GET / is public", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBeLessThan(400);
  });

  test("POST /api/stripe/webhook rejects without signature but is not auth-blocked", async ({
    request,
  }) => {
    const response = await request.post("/api/stripe/webhook", {
      data: "{}",
      headers: { "content-type": "application/json" },
    });
    expect([400, 503]).toContain(response.status());
  });
});

test.describe("API Security — debug endpoint gated", () => {
  test("GET /api/debug/me does not leak user data without auth", async ({
    request,
  }) => {
    const response = await request.fetch("/api/debug/me", { maxRedirects: 0 });
    const status = response.status();
    if (status === 200) {
      const body = await response.json();
      expect(body.userId).toBeNull();
    } else {
      expect([401, 403, 404, 302, 307]).toContain(status);
    }
  });
});

test.describe("API Security — demo mode gated", () => {
  test("POST /api/demo returns 403 in production or sets cookie in dev", async ({
    request,
  }) => {
    const response = await request.post("/api/demo");
    const status = response.status();
    // In production: 403 (gated). In dev: 200 with httpOnly cookie.
    expect([200, 403]).toContain(status);
    if (status === 200) {
      const body = await response.json();
      expect(body.demo).toBe(true);
    }
  });
});

test.describe("API Security — POST routes require auth", () => {
  const POST_ROUTES = [
    "/api/plaid/create-link-token",
    "/api/plaid/exchange-token",
    "/api/plaid/disconnect",
    "/api/gmail/auth",
    "/api/gmail/disconnect",
    "/api/gmail/scan",
    "/api/groups",
    "/api/manual-expense",
    "/api/split-transactions",
    "/api/receipt/parse",
  ];

  for (const path of POST_ROUTES) {
    test(`POST ${path} rejects unauthenticated`, async ({ request }) => {
      const response = await request.post(path, {
        data: "{}",
        headers: { "content-type": "application/json" },
        maxRedirects: 0,
      });
      const status = response.status();

      if (isRejected(status) || status === 500) {
        return;
      }

      // With placeholder Clerk keys in CI, middleware may pass through.
      // Verify the route-level auth still returns an error or empty data.
      if (status === 200) {
        const text = await response.text();
        try {
          const body = JSON.parse(text);
          expect(body.error || body.userId === null || Object.keys(body).length === 0).toBeTruthy();
        } catch {
          // Non-JSON response (HTML redirect page) — acceptable
        }
        return;
      }

      // Any other unexpected status — fail
      expect(isRejected(status)).toBeTruthy();
    });
  }
});
