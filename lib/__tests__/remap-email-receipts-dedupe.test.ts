/**
 * remapEmailReceiptsBeforeTxDedupeDelete must point receipts at the kept row before duplicate tx deletes,
 * then clear any remaining FKs to those duplicate ids so deletes never hit email_receipts_transaction_id_fkey.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { remapEmailReceiptsBeforeTxDedupeDelete } from "@/lib/transaction-sync";

type UpdateCall =
  | { kind: "remap"; keptId: string; chunk: string[]; clerkUserId: string }
  | { kind: "clear"; chunk: string[]; clerkUserId: string };

function createMockSupabase(capture: UpdateCall[]) {
  return {
    from(_table: string) {
      return {
        update(data: { transaction_id: string | null }) {
          const tid = data.transaction_id;
          return {
            in(_col: string, chunk: string[]) {
              return {
                eq(_c: string, clerkUserId: string) {
                  if (tid === null) {
                    capture.push({ kind: "clear", chunk: [...chunk], clerkUserId });
                  } else {
                    capture.push({ kind: "remap", keptId: tid, chunk: [...chunk], clerkUserId });
                  }
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
  it("groups duplicate ids by kept transaction, remaps, then clears FKs for the batch", async () => {
    const calls: UpdateCall[] = [];
    const db = createMockSupabase(calls);
    const duplicateIdToKeptId = new Map<string, string>([
      ["dup-b", "keep-a"],
      ["dup-c", "keep-a"],
      ["dup-d", "keep-e"],
    ]);
    const batch = ["dup-b", "dup-c", "dup-d"];
    await remapEmailReceiptsBeforeTxDedupeDelete(db, "user_1", duplicateIdToKeptId, batch);
    const remaps = calls.filter((c): c is Extract<UpdateCall, { kind: "remap" }> => c.kind === "remap");
    const clears = calls.filter((c): c is Extract<UpdateCall, { kind: "clear" }> => c.kind === "clear");
    expect(remaps).toHaveLength(2);
    const forA = remaps.find((c) => c.keptId === "keep-a");
    const forE = remaps.find((c) => c.keptId === "keep-e");
    expect(forA?.chunk.sort()).toEqual(["dup-b", "dup-c"]);
    expect(forE?.chunk).toEqual(["dup-d"]);
    expect(clears).toHaveLength(1);
    expect(clears[0].chunk).toEqual(batch);
    expect(calls.every((c) => c.clerkUserId === "user_1")).toBe(true);
  });

  it("still clears FKs for ids missing from the duplicate→kept map", async () => {
    const calls: UpdateCall[] = [];
    const db = createMockSupabase(calls);
    const duplicateIdToKeptId = new Map<string, string>([["x", "keep"]]);
    await remapEmailReceiptsBeforeTxDedupeDelete(db, "u", duplicateIdToKeptId, ["x", "orphan"]);
    const remaps = calls.filter((c) => c.kind === "remap");
    const clears = calls.filter((c) => c.kind === "clear");
    expect(remaps).toHaveLength(1);
    expect(remaps[0].chunk).toEqual(["x"]);
    expect(clears).toHaveLength(1);
    expect(clears[0].chunk).toEqual(["x", "orphan"]);
  });
});
