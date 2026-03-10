import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

const sidebarLinks = [
  { label: "Overview", path: "/app/dashboard" },
  { label: "Transactions", path: "/app/transactions" },
  { label: "Subscriptions", path: "/app/subscriptions" },
  { label: "Shared", path: "/app/shared" },
  { label: "Split Receipt", path: "/app/receipt" },
  { label: "Email Receipts", path: "/app/email-receipts" },
  { label: "Settings", path: "/app/settings" },
];

test.describe("Navigation — sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
  });

  test("sidebar shows all nav items", async ({ page }) => {
    for (const { label } of sidebarLinks) {
      await expect(page.locator("aside").getByText(label)).toBeVisible();
    }
  });

  test("sidebar highlights active route", async ({ page }) => {
    const overviewLink = page.locator("aside").getByText("Overview");
    const classes = await overviewLink.getAttribute("class");
    expect(classes).toContain("text-[#3D8E62]");
  });

  test("sidebar shows Coconut branding", async ({ page }) => {
    await expect(page.locator("aside").getByText("Coconut")).toBeVisible();
  });

  test("user info is visible in sidebar", async ({ page }) => {
    const sidebar = page.locator("aside");
    const userSection = sidebar.locator("button").last();
    await expect(userSection).toBeVisible();
  });

  for (const { label, path } of sidebarLinks) {
    test(`clicking "${label}" navigates to ${path}`, async ({ page }) => {
      const link = page.locator("aside").getByText(label);
      await link.click();
      await page.waitForURL(`**${path}**`);
      expect(page.url()).toContain(path);
    });
  }
});

test.describe("Navigation — header", () => {
  test("header search bar is visible", async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
    const searchInput = page.getByPlaceholder(/search your money/i);
    await expect(searchInput).toBeVisible();
  });

  test("search navigates to transactions with query", async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
    const searchInput = page.getByPlaceholder(/search your money/i);
    await searchInput.fill("coffee");
    await searchInput.press("Enter");
    await page.waitForURL("**/app/transactions**");
    expect(page.url()).toContain("q=coffee");
  });

  test("notification bell is visible", async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
    const bell = page.locator("header button").first();
    await expect(bell).toBeVisible();
  });
});

test.describe("Navigation — /app redirect", () => {
  test("/app redirects to /app/dashboard", async ({ page }) => {
    await goAuthenticated(page, "/app");
    await page.waitForURL("**/app/dashboard**");
    expect(page.url()).toContain("/app/dashboard");
  });
});
