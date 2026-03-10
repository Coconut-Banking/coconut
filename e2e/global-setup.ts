import { clerkSetup } from "@clerk/testing/playwright";
import { loadEnvConfig } from "@next/env";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

export const CLERK_READY_MARKER = join(
  process.cwd(), "node_modules", ".cache", ".clerk-e2e-ready",
);

export default async function globalSetup() {
  loadEnvConfig(process.cwd());

  try { unlinkSync(CLERK_READY_MARKER); } catch {}

  if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }

  if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    console.warn("[e2e] Clerk keys missing — authenticated tests will be skipped.");
    return;
  }

  // Verify the server accepts the secret key before running clerkSetup.
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  try {
    const probe = await fetch(`${baseURL}/api/debug/me`, { redirect: "manual" });
    if (probe.status === 500) {
      console.warn(
        "[e2e] Server returned 500 — CLERK_SECRET_KEY may be invalid. " +
          "Authenticated tests will be skipped.",
      );
      return;
    }
  } catch {
    // Server not reachable yet — Playwright's webServer will start it
  }

  try {
    await Promise.race([
      clerkSetup(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("clerkSetup timed out (15 s)")), 15_000),
      ),
    ]);
    mkdirSync(join(process.cwd(), "node_modules", ".cache"), { recursive: true });
    writeFileSync(CLERK_READY_MARKER, Date.now().toString());
  } catch (err) {
    console.warn(`[e2e] clerkSetup failed — authenticated tests will be skipped: ${err}`);
  }
}
