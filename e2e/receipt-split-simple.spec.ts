import { test, expect } from "@playwright/test";
import { goAuthenticated } from "./helpers";

test.describe("Receipt Split", () => {
  test("can navigate to receipt split page", async ({ page }) => {
    await goAuthenticated(page, "/app/receipt");
    await expect(page.getByText("Split Receipt")).toBeVisible();
    await expect(page.getByText("Scan a receipt and split items with friends")).toBeVisible();
  });

  test("shows upload step initially", async ({ page }) => {
    await goAuthenticated(page, "/app/receipt");
    await expect(page.getByText("Drop a receipt image here")).toBeVisible();
  });

  test("can add people in assign step", async ({ page }) => {
    await goAuthenticated(page, "/app/receipt");
    await page.evaluate(() => {
      window.localStorage.setItem("receipt-step", "assign");
    });
  });
});
