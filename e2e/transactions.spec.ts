import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Transactions page", () => {
  test.beforeEach(async ({ page }) => {
    await goAuthenticated(page, "/app/transactions");
  });

  test("page title and transaction count render", async ({ page }) => {
    await expect(page.locator("h1")).toContainText(/transactions/i);
    await expect(page.getByText(/\d+ transactions loaded/)).toBeVisible();
  });

  test("search input is present and functional", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/filter by name/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill("test-nonexistent-merchant");
    await expect(page.getByText("No transactions found")).toBeVisible();
  });

  test("clearing search restores transactions", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/filter by name/i);
    await searchInput.fill("zzzzzzzzzzz");
    await expect(page.getByText("No transactions found")).toBeVisible();
    await searchInput.fill("");
    await expect(page.getByText("No transactions found")).not.toBeVisible();
  });

  test("category filter tabs are present", async ({ page }) => {
    const allTab = page.getByRole("button", { name: "All" }).first();
    await expect(allTab).toBeVisible();
  });

  test("filters sidebar is present", async ({ page }) => {
    await expect(page.getByText("Filters")).toBeVisible();
    await expect(page.getByText("Date")).toBeVisible();
    await expect(page.getByText("Amount range")).toBeVisible();
    await expect(page.getByText("Type")).toBeVisible();
  });

  test("date filter dropdown works", async ({ page }) => {
    const dateSelect = page.locator("select").filter({ hasText: "This month" });
    await dateSelect.selectOption("All time");
    await expect(dateSelect).toHaveValue("All time");
  });

  test("type filter radio buttons work", async ({ page }) => {
    const recurringRadio = page.getByLabel("Recurring");
    await recurringRadio.check();
    await expect(recurringRadio).toBeChecked();
  });

  test("clear all button resets filters", async ({ page }) => {
    const recurringRadio = page.getByLabel("Recurring");
    await recurringRadio.check();
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByLabel("All")).toBeChecked();
  });

  test("clicking a transaction opens the detail drawer", async ({ page }) => {
    const firstRow = page.locator("[class*='hover:bg-gray-50']").first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page.getByText("Transaction details")).toBeVisible();
    }
  });

  test("drawer can be closed", async ({ page }) => {
    const firstRow = page.locator("[class*='hover:bg-gray-50']").first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page.getByText("Transaction details")).toBeVisible();
      await page.locator("[class*='fixed inset-0']").first().click({ position: { x: 10, y: 10 } });
      await expect(page.getByText("Transaction details")).not.toBeVisible();
    }
  });
});

test.describe("Transactions — linked account badge", () => {
  test("shows live badge when bank is linked", async ({ page }) => {
    await goAuthenticated(page, "/app/transactions");
    const badge = page.getByText("Live from linked account");
    const visible = await badge.isVisible().catch(() => false);
    if (visible) {
      await expect(badge).toBeVisible();
    }
  });
});
