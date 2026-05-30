import { describe, expect, it } from "vitest";
import { debugEndpointDisabledResponse } from "../debug-guard";

describe("debugEndpointDisabledResponse", () => {
  it("returns 404 when ENABLE_DEBUG_ENDPOINTS is not true", () => {
    const prev = process.env.ENABLE_DEBUG_ENDPOINTS;
    delete process.env.ENABLE_DEBUG_ENDPOINTS;
    const res = debugEndpointDisabledResponse();
    expect(res?.status).toBe(404);
    if (prev !== undefined) process.env.ENABLE_DEBUG_ENDPOINTS = prev;
  });

  it("returns null when ENABLE_DEBUG_ENDPOINTS is true", () => {
    const prev = process.env.ENABLE_DEBUG_ENDPOINTS;
    process.env.ENABLE_DEBUG_ENDPOINTS = "true";
    expect(debugEndpointDisabledResponse()).toBeNull();
    if (prev !== undefined) process.env.ENABLE_DEBUG_ENDPOINTS = prev;
    else delete process.env.ENABLE_DEBUG_ENDPOINTS;
  });
});
