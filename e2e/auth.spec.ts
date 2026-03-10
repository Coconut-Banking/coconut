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
      await page.waitForLoadState("networkidle");
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
  test("login page is accessible without auth", async ({ page }) => {
    const response = await page.goto("/login");
    const status = response?.status() ?? 0;
    // login page might redirect to Clerk hosted sign-in
    expect(status).toBeLessThan(500);
  });

  test("home page is accessible without auth", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
  });
});
