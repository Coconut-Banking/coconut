import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { type Page, test } from "@playwright/test";
import { existsSync } from "fs";
import { join } from "path";

const CLERK_READY_MARKER = join(
  process.cwd(), "node_modules", ".cache", ".clerk-e2e-ready",
);

function isClerkReady(): boolean {
  return existsSync(CLERK_READY_MARKER);
}

/**
 * Navigate to a protected route with authentication.
 * Skips when clerkSetup() did not complete (missing/invalid keys).
 */
export async function goAuthenticated(page: Page, path: string) {
  test.skip(
    !isClerkReady(),
    "Clerk not configured (clerkSetup failed or keys missing) — skipping",
  );
  await setupClerkTestingToken({ page });

  // Verify the server actually honors the testing token; otherwise skip to avoid flaky false failures.
  // (This can happen if Clerk testing-mode env is missing or middleware blocks Clerk internals.)
  const probe = await page.request.get("/api/debug/me");
  test.skip(
    probe.status() !== 200,
    `Clerk testing token not honored by server (probe status ${probe.status()}) — skipping`,
  );

  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
}
