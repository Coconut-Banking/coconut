import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  // clerkSetup requires CLERK_PUBLISHABLE_KEY in the environment.
  // In keyless/dev mode Clerk auto-generates a temporary key but doesn't
  // set it as an env var. If missing, skip Clerk testing setup — individual
  // tests will call setupClerkTestingToken which handles this gracefully.
  if (!process.env.CLERK_PUBLISHABLE_KEY) {
    console.warn(
      "[e2e] CLERK_PUBLISHABLE_KEY not set — skipping clerkSetup. " +
        "Set it in .env.local to enable authenticated E2E tests."
    );
    return;
  }
  await clerkSetup();
}
