import { describe, it, expect } from "vitest";
import { dedupeGroupMembersToPeople, type GroupMemberForPeople } from "../group-people-dedupe";

const groups = new Map([
  ["g1", { id: "g1", name: "Trip" }],
  ["g2", { id: "g2", name: "Dinner" }],
  ["g3", { id: "g3", name: "Aaran Muraleetharan" }],
]);
const counts = new Map([
  ["g1", 4],
  ["g2", 3],
  ["g3", 2],
]);

function member(
  partial: Partial<GroupMemberForPeople> & Pick<GroupMemberForPeople, "id" | "group_id" | "display_name">,
): GroupMemberForPeople {
  return {
    user_id: null,
    email: null,
    ...partial,
  };
}

describe("dedupeGroupMembersToPeople", () => {
  it("merges same display name across groups when no email/user_id", () => {
    const people = dedupeGroupMembersToPeople(
      [
        member({ id: "m1", group_id: "g1", display_name: "Aaran Muraleetharan" }),
        member({ id: "m2", group_id: "g2", display_name: "Aaran Muraleetharan" }),
        member({
          id: "m3",
          group_id: "g3",
          display_name: "Aaran Muraleetharan",
          email: "aaran@example.com",
        }),
      ],
      groups,
      counts,
      "me",
    );
    expect(people).toHaveLength(1);
    expect(people[0].email).toBe("aaran@example.com");
    expect(people[0].groupId).toBe("g3");
  });

  it("merges by email across groups", () => {
    const people = dedupeGroupMembersToPeople(
      [
        member({ id: "m1", group_id: "g1", display_name: "Aaran", email: "a@x.com" }),
        member({ id: "m2", group_id: "g2", display_name: "Aaran M.", email: "a@x.com" }),
      ],
      groups,
      counts,
      "me",
    );
    expect(people).toHaveLength(1);
  });

  it("keeps distinct people with different emails", () => {
    const people = dedupeGroupMembersToPeople(
      [
        member({ id: "m1", group_id: "g1", display_name: "Chris", email: "c1@x.com" }),
        member({ id: "m2", group_id: "g2", display_name: "Chris", email: "c2@x.com" }),
      ],
      groups,
      counts,
      "me",
    );
    expect(people).toHaveLength(2);
  });
});
