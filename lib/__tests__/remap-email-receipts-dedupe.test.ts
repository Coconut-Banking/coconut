/**
 * remapEmailReceiptsBeforeTxDedupeDelete must point receipts at the kept row before duplicate tx deletes.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { remapEmailReceiptsBeforeTxDedupeDelete } from "@/lib/transaction-sync";

type UpdateCall = { keptId: string; chunk: string[]; clerkUserId: string };

function createMockSupabase(capture: UpdateCall[]) {
  return {
    from(_table: string) {
      return {
        update(data: { transaction_id: string }) {
          const keptId = data.transaction_id;
          return {
            in(_col: string, chunk: string[]) {
              return {
                eq(_c: string, clerkUserId: string) {
                  capture.push({ keptId, chunk: [...chunk], clerkUserId });
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("remapEmailReceiptsBeforeTxDedupeDelete", () => {
  it("groups duplicate ids by kept transaction and updates in chunks", async () => {
    const calls: UpdateCall[] = [];
    const db = createMockSupabase(calls);
    const duplicateIdToKeptId = new Map<string, string>([
      ["dup-b", "keep-a"],
      ["dup-c", "keep-a"],
      ["dup-d", "keep-e"],
    ]);
    await remapEmailReceiptsBeforeTxDedupeDelete(db, "user_1", duplicateIdToKeptId, [
      "dup-b",
      "dup-c",
      "dup-d",
    ]);
    expect(calls).toHaveLength(2);
    const forA = calls.find((c) => c.keptId === "keep-a");
    const forE = calls.find((c) => c.keptId === "keep-e");
    expect(forA?.chunk.sort()).toEqual(["dup-b", "dup-c"]);
    expect(forE?.chunk).toEqual(["dup-d"]);
    expect(calls.every((c) => c.clerkUserId === "user_1")).toBe(true);
  });

  it("skips duplicate ids missing from the map", async () => {
    const calls: UpdateCall[] = [];
    const db = createMockSupabase(calls);
    const duplicateIdToKeptId = new Map<string, string>([["x", "keep"]]);
    await remapEmailReceiptsBeforeTxDedupeDelete(db, "u", duplicateIdToKeptId, ["x", "orphan"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].chunk).toEqual(["x"]);
  });
});
