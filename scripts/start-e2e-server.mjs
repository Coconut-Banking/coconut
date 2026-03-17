import { spawn } from "node:child_process";
import nextEnvPkg from "@next/env";
import { clerkSetup } from "@clerk/testing/playwright";

const { loadEnvConfig } = nextEnvPkg;
loadEnvConfig(process.cwd());

if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

// Force auth ON during E2E even if .env.local sets SKIP_AUTH=true.
process.env.SKIP_AUTH = "false";
process.env.NEXT_PUBLIC_SKIP_AUTH = "false";

async function main() {
  // Fetch Clerk testing token so both the test runner and server accept testing cookies.
  await clerkSetup();

  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  const shutdown = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[e2e-server] failed to start:", err);
  process.exit(1);
});

