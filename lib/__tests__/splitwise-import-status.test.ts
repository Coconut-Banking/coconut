import { describe, it, expect } from "vitest";
import { splitwiseImportAlreadyCompletedMessage } from "../splitwise-import-status";

describe("splitwiseImportAlreadyCompletedMessage", () => {
  it("includes formatted date when provided", () => {
    const msg = splitwiseImportAlreadyCompletedMessage("2026-05-28T12:00:00.000Z");
    expect(msg).toContain("already imported");
    expect(msg).toContain("one-time");
    expect(msg).toMatch(/May/);
  });

  it("works without a date", () => {
    const msg = splitwiseImportAlreadyCompletedMessage(null);
    expect(msg).toContain("already imported");
    expect(msg).not.toContain(" on ");
  });
});
