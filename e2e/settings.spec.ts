import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await goAuthenticated(page, "/app/settings");
  });

  test("page title and description render", async ({ page }) => {
    await expect(page.locator("h1")).toContainText(/settings/i);
    await expect(page.getByText("Manage your account")).toBeVisible();
  });

  test("section nav has all expected items", async ({ page }) => {
    for (const label of ["Profile", "Connected Banks", "Email Receipts", "Security", "Data & Export"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("profile section shows user info form", async ({ page }) => {
    await expect(page.getByText("Full name")).toBeVisible();
    await expect(page.getByText("Email address")).toBeVisible();
    await expect(page.getByText("Currency")).toBeVisible();
    await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible();
  });

  test("notifications toggles are visible in profile section", async ({ page }) => {
    await expect(page.getByText("Notifications")).toBeVisible();
    await expect(page.getByText("Large transactions")).toBeVisible();
    await expect(page.getByText("Weekly digest")).toBeVisible();
  });

  test("connected banks section loads", async ({ page }) => {
    await page.getByRole("button", { name: "Connected Banks" }).click();
    await expect(page.getByText("Connected banks")).toBeVisible();
  });

  test("email receipts section loads", async ({ page }) => {
    await page.getByRole("button", { name: "Email Receipts" }).click();
    await expect(page.getByText("Email Receipts").first()).toBeVisible();
  });

  test("security section has expected controls", async ({ page }) => {
    await page.getByRole("button", { name: "Security" }).click();
    await expect(page.getByText("Two-factor authentication")).toBeVisible();
    await expect(page.getByText("Change password")).toBeVisible();
    await expect(page.getByText("Active sessions")).toBeVisible();
    await expect(page.getByText("Login notifications")).toBeVisible();
  });

  test("danger zone with delete account is visible in security", async ({ page }) => {
    await page.getByRole("button", { name: "Security" }).click();
    await expect(page.getByText("Danger zone")).toBeVisible();
    await expect(page.getByRole("button", { name: /delete account/i })).toBeVisible();
  });

  test("data & export section loads with export buttons", async ({ page }) => {
    await page.getByRole("button", { name: "Data & Export" }).click();
    await expect(page.getByText("Data & Export").first()).toBeVisible();
    await expect(page.getByText("Export transactions")).toBeVisible();
    await expect(page.getByText("Export subscriptions")).toBeVisible();
  });

  test("data privacy section shows policy items", async ({ page }) => {
    await page.getByRole("button", { name: "Data & Export" }).click();
    await expect(page.getByText("Data privacy")).toBeVisible();
    await expect(page.getByText(/encrypted at rest/)).toBeVisible();
    await expect(page.getByText(/never sell your data/)).toBeVisible();
  });

  test("read privacy policy link is visible", async ({ page }) => {
    await page.getByRole("button", { name: "Data & Export" }).click();
    await expect(page.getByText("Read our full privacy policy")).toBeVisible();
  });
});
