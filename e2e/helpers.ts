import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { type Page, test } from "@playwright/test";

const clerkConfigured = !!process.env.CLERK_PUBLISHABLE_KEY;

/**
 * Injects the Clerk testing token so the browser session is treated as
 * authenticated by the Clerk middleware. Call once per test before navigation.
 */
export async function authenticatePage(page: Page) {
  await setupClerkTestingToken({ page });
}

/**
 * Navigate to a protected route with authentication.
 * Waits for the page to finish loading after navigation.
 * Skips the test when CLERK_PUBLISHABLE_KEY is not configured.
 */
export async function goAuthenticated(page: Page, path: string) {
  test.skip(!clerkConfigured, "CLERK_PUBLISHABLE_KEY not set — skipping authenticated test");
  await authenticatePage(page);
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
}
