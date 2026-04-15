import { vi } from "vitest";

// React `cache` is a React Server Components API unavailable in jsdom.
// Provide a no-op pass-through so route modules can be imported in tests.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  };
});
