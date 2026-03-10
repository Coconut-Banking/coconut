import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Shared page", () => {
  test("loads shared page when not authenticated", async ({ page }) => {
    await page.goto("/app/shared");
    await expect(page).toHaveURL(/.*login|.*sign-in|.*clerk|.*accounts\.dev/);
  });

  test("shared page has expected structure when connected", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    const hasCreateButton = await page
      .getByRole("button", { name: /new group|create group/i })
      .isVisible()
      .catch(() => false);
    const hasAddExpense = await page
      .getByRole("button", { name: /add expense/i })
      .isVisible()
      .catch(() => false);
    const hasSharedTitle = await page
      .getByText(/shared/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasCreateButton || hasAddExpense || hasSharedTitle).toBeTruthy();
  });

  test("Add expense button is visible and prominent", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    const addBtn = page.getByRole("button", { name: /add expense/i });
    await expect(addBtn).toBeVisible();
  });

  test("New group button opens create group form", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    const newGroupBtn = page.getByRole("button", { name: /new group|create group/i });
    await newGroupBtn.click();
    await expect(page.getByPlaceholder(/group name|e\.g\. apartment/i)).toBeVisible();
  });

  test("Create group form has group type options", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    await page.getByRole("button", { name: /new group|create group/i }).click();
    await expect(page.getByText(/home|trip|couple|other/i).first()).toBeVisible();
  });

  test("Add expense modal opens from Add expense button", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    await page.getByRole("button", { name: /add expense/i }).click();
    await expect(page.getByRole("heading", { name: /add expense/i })).toBeVisible();
  });

  test("Add expense modal shows amount and description fields", async ({ page }) => {
    await goAuthenticated(page, "/app/shared");
    await page.getByRole("button", { name: /add expense/i }).click();
    await expect(page.getByPlaceholder(/0\.00/)).toBeVisible();
    await expect(page.getByPlaceholder(/dinner|groceries|what for/i)).toBeVisible();
  });
});
