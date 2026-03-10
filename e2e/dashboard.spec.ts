import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await goAuthenticated(page, "/app/dashboard");
  });

  test("shows personalized greeting with time of day", async ({ page }) => {
    const h1 = page.locator("h1");
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text).toMatch(/good (morning|afternoon|evening)/i);
  });

  test("renders stat cards", async ({ page }) => {
    await expect(page.getByText("Monthly Spend")).toBeVisible();
    await expect(page.getByText("Subscriptions")).toBeVisible();
    await expect(page.getByText("Shared Expenses")).toBeVisible();
    await expect(page.getByText("Net Cash Flow")).toBeVisible();
  });

  test("renders spending chart section", async ({ page }) => {
    await expect(page.getByText("Monthly Spending")).toBeVisible();
    await expect(page.getByText("Last 6 months")).toBeVisible();
  });

  test("renders top categories section", async ({ page }) => {
    await expect(page.getByText("Top Categories")).toBeVisible();
  });

  test("renders recent transactions section", async ({ page }) => {
    await expect(page.getByText("Recent Transactions")).toBeVisible();
    await expect(page.getByText("View all")).toBeVisible();
  });

  test("view all link navigates to transactions page", async ({ page }) => {
    await page.getByText("View all").click();
    await page.waitForURL("**/app/transactions**");
    await expect(page.locator("h1")).toContainText(/transactions/i);
  });

  test("renders smart insights section", async ({ page }) => {
    await expect(page.getByText("Smart Insights")).toBeVisible();
  });

  test("displays current month and year", async ({ page }) => {
    const now = new Date();
    const monthYear = now.toLocaleString("en", { month: "long", year: "numeric" });
    await expect(page.getByText(monthYear)).toBeVisible();
  });
});
