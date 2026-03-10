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
      .getByRole("button", { name: /create group/i })
      .isVisible()
      .catch(() => false);
    const hasSharedTitle = await page
      .getByText(/shared expenses?/i)
      .isVisible()
      .catch(() => false);
    expect(hasCreateButton || hasSharedTitle).toBeTruthy();
  });
});
