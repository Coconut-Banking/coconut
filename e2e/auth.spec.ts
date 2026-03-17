import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Authentication — unauthenticated redirects", () => {
  for (const route of [
    "/app/dashboard",
    "/app/transactions",
    "/app/subscriptions",
    "/app/shared",
    "/app/settings",
    "/app/email-receipts",
    "/app/receipt",
  ]) {
    test(`${route} redirects to login when unauthenticated`, async ({ page }) => {
      await page.goto(route);
      // Clerk pages can keep long-polling connections open; "networkidle" can hang.
      await page.waitForURL((url) => {
        return (
          url.pathname.includes("/login") ||
          url.pathname.includes("/sign-in") ||
          url.hostname.includes("clerk") ||
          url.hostname.includes("accounts.dev")
        );
      });
      const url = page.url();
      expect(
        url.includes("/login") ||
          url.includes("/sign-in") ||
          url.includes("clerk") ||
          url.includes("accounts.dev")
      ).toBeTruthy();
    });
  }
});

test.describe("Authentication — authenticated access", () => {
  test("dashboard loads when authenticated", async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
    await expect(page.locator("h1")).toContainText(/good (morning|afternoon|evening)/i);
  });

  test("transactions page loads when authenticated", async ({ page }) => {
    await goAuthenticated(page, "/app/transactions");
    await expect(page.locator("h1")).toContainText(/transactions/i);
  });

  test("settings page loads when authenticated", async ({ page }) => {
    await goAuthenticated(page, "/app/settings");
    await expect(page.locator("h1")).toContainText(/settings/i);
  });
});

test.describe("Authentication — public pages", () => {
  test("login page does not require auth", async ({ page }) => {
    const response = await page.goto("/login");
    const status = response?.status() ?? 0;
    // CI uses placeholder Clerk keys so SSR may 500 — that's a config
    // issue, not an auth issue. We just verify it doesn't 401/403.
    expect(status !== 401 && status !== 403).toBeTruthy();
  });

  test("home page does not require auth", async ({ page }) => {
    const response = await page.goto("/");
    const status = response?.status() ?? 0;
    expect(status !== 401 && status !== 403).toBeTruthy();
  });
});
