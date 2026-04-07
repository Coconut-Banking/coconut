import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendPushNotification,
  sendPushNotificationBatch,
} from "../push-sender";

// Mock the supabase module so importing push-sender doesn't fail at module load
vi.mock("../supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

describe("push-sender — HTTP error handling (BUG-RESILIENCE-2)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("sendPushNotification", () => {
    it("returns error ticket (does NOT throw) when Expo API returns 503", async () => {
      // Mock fetch to simulate a 503 Service Unavailable with HTML body
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
        text: () => Promise.resolve("<html>Service Unavailable</html>"),
      } as unknown as Response);

      // Old code would throw a SyntaxError from res.json(); fixed code returns gracefully
      await expect(
        sendPushNotification("ExponentPushToken[xxx]", "Hello", "World")
      ).resolves.toMatchObject({
        status: "error",
        message: "HTTP 503",
      });
    });

    it("returns error ticket when Expo API returns 429 Too Many Requests", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
        text: () => Promise.resolve("Too Many Requests"),
      } as unknown as Response);

      const ticket = await sendPushNotification(
        "ExponentPushToken[yyy]",
        "Test",
        "Body"
      );
      expect(ticket.status).toBe("error");
      expect(ticket.message).toContain("429");
    });

    it("returns the ticket normally on a successful 200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { status: "ok", id: "ticket-123" },
          }),
      } as unknown as Response);

      const ticket = await sendPushNotification(
        "ExponentPushToken[zzz]",
        "Hello",
        "World"
      );
      expect(ticket).toEqual({ status: "ok", id: "ticket-123" });
    });
  });

  describe("sendPushNotificationBatch", () => {
    it("returns empty array (does NOT throw) when Expo API returns 503", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
        text: () => Promise.resolve("<html>Service Unavailable</html>"),
      } as unknown as Response);

      // Old code would throw; fixed code returns []
      await expect(
        sendPushNotificationBatch(
          ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"],
          "Title",
          "Body"
        )
      ).resolves.toEqual([]);
    });

    it("returns empty array when Expo API returns 500", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
        text: () => Promise.resolve("Internal Server Error"),
      } as unknown as Response);

      const tickets = await sendPushNotificationBatch(
        ["ExponentPushToken[ccc]"],
        "Title",
        "Body"
      );
      expect(tickets).toEqual([]);
    });

    it("returns tickets array normally on a successful 200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              { status: "ok", id: "t1" },
              { status: "ok", id: "t2" },
            ],
          }),
      } as unknown as Response);

      const tickets = await sendPushNotificationBatch(
        ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"],
        "Title",
        "Body"
      );
      expect(tickets).toEqual([
        { status: "ok", id: "t1" },
        { status: "ok", id: "t2" },
      ]);
    });

    it("returns empty array immediately when tokens list is empty (no fetch call)", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const tickets = await sendPushNotificationBatch([], "Title", "Body");
      expect(tickets).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
