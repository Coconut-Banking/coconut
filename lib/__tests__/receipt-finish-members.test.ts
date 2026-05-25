import { describe, expect, it } from "vitest";
import {
  buildMemberNameMap,
  collectMissingAssigneeNames,
  peopleToEnsureInGroup,
  resolveAssignmentMemberId,
} from "../receipt-finish-members";

describe("resolveAssignmentMemberId", () => {
  const memberByName = new Map([["alice", "m-alice"]]);
  const inGroup = new Set(["m-alice", "m-me"]);

  it("rejects member_id from another group and resolves by name", () => {
    const id = resolveAssignmentMemberId(
      { assignee_name: "Alice", member_id: "m-other-group" },
      memberByName,
      inGroup,
    );
    expect(id).toBe("m-alice");
  });

  it("returns null when name is not in group", () => {
    const id = resolveAssignmentMemberId(
      { assignee_name: "Bob", member_id: "m-other-group" },
      memberByName,
      inGroup,
    );
    expect(id).toBeNull();
  });
});

describe("peopleToEnsureInGroup", () => {
  it("merges receipt people and missing assignees", () => {
    const out = peopleToEnsureInGroup(
      [{ name: "Koushik", email: "k@example.com" }],
      ["Aaran"],
    );
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.name).sort()).toEqual(["Aaran", "Koushik"]);
  });
});

describe("collectMissingAssigneeNames", () => {
  it("lists names not in member map", () => {
    const map = buildMemberNameMap([{ id: "m1", display_name: "You" }]);
    expect(collectMissingAssigneeNames(["You", "Koushik"], map)).toEqual(["Koushik"]);
  });
});
