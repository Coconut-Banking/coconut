import { describe, expect, it } from "vitest";
import { tokenFromPayUrl } from "../pay-url-token";

describe("tokenFromPayUrl", () => {
  it("extracts token from absolute pay URL", () => {
    expect(tokenFromPayUrl("https://coconut-app.dev/pay/abc123")).toBe("abc123");
  });

  it("extracts encoded token", () => {
    expect(tokenFromPayUrl("https://example.com/pay/foo%2Fbar")).toBe("foo/bar");
  });

  it("returns null for empty", () => {
    expect(tokenFromPayUrl(null)).toBeNull();
    expect(tokenFromPayUrl("")).toBeNull();
  });
});
