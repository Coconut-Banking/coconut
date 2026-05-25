export type ReceiptFinishPerson = { name: string; email?: string | null };

export type GroupMemberRow = {
  id: string;
  display_name: string | null;
  email?: string | null;
};

/** Ignore assignment member_ids that belong to another group. */
export function resolveAssignmentMemberId(
  assignment: { assignee_name?: string | null; member_id?: string | null },
  memberByName: Map<string, string>,
  memberIdsInGroup: Set<string>,
): string | null {
  let memberId = assignment.member_id ?? null;
  if (memberId && !memberIdsInGroup.has(memberId)) {
    memberId = null;
  }
  if (!memberId && assignment.assignee_name) {
    memberId = memberByName.get(assignment.assignee_name.toLowerCase()) ?? null;
  }
  return memberId;
}

export function buildMemberNameMap(members: GroupMemberRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    const key = m.display_name?.toLowerCase() ?? "";
    if (key) map.set(key, m.id);
  }
  return map;
}

export function collectMissingAssigneeNames(
  assigneeNames: Iterable<string>,
  memberByName: Map<string, string>,
): string[] {
  const missing = new Set<string>();
  for (const raw of assigneeNames) {
    const name = raw?.trim();
    if (!name) continue;
    if (!memberByName.has(name.toLowerCase())) {
      missing.add(name);
    }
  }
  return [...missing];
}

/** Names to add as guest members (receipt people + assignees not yet in group). */
export function peopleToEnsureInGroup(
  people: ReceiptFinishPerson[],
  missingAssigneeNames: string[],
): ReceiptFinishPerson[] {
  const byKey = new Map<string, ReceiptFinishPerson>();
  for (const p of people) {
    const name = p.name?.trim();
    if (!name) continue;
    byKey.set(name.toLowerCase(), { name, email: p.email ?? null });
  }
  for (const name of missingAssigneeNames) {
    const key = name.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, { name });
    }
  }
  return [...byKey.values()];
}
