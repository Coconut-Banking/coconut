import { describe, it, expect } from "vitest";
import { merchantLlmResultKey } from "../merchant-normalize-llm";

describe("merchantLlmResultKey", () => {
  it("differs when category differs for same raw", () => {
    const raw = "Some Long Merchant Name That Exceeds Heuristics";
    expect(merchantLlmResultKey(raw, "FOOD")).not.toBe(merchantLlmResultKey(raw, "TRAVEL"));
  });

  it("is stable for same raw and category", () => {
    expect(merchantLlmResultKey("Acme Corp", "OTHER")).toBe(merchantLlmResultKey("Acme Corp", "OTHER"));
  });
});
