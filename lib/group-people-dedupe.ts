export type GroupMemberForPeople = {
  id: string;
  group_id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
};

export type DedupedGroupPerson = {
  displayName: string;
  email: string | null;
  groupId: string;
  groupName: string;
  memberId: string;
  memberCount: number;
};

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}

type Candidate = DedupedGroupPerson & { userId: string | null };

function personScore(c: Candidate): number {
  let score = 0;
  if (c.email) score += 100;
  if (c.userId) score += 50;
  if (c.memberCount === 2) score += 10;
  return score;
}

function pickBetter(a: Candidate, b: Candidate): Candidate {
  const sa = personScore(a);
  const sb = personScore(b);
  if (sb > sa) return b;
  if (sa > sb) return a;
  return a.displayName.length >= b.displayName.length ? a : b;
}

/**
 * One row per real person for split pickers.
 * Merges by user_id, then email, then exact normalized display name.
 */
export function dedupeGroupMembersToPeople(
  members: GroupMemberForPeople[],
  groupMap: Map<string, { id: string; name: string }>,
  memberCountByGroup: Map<string, number>,
  excludeUserId: string,
): DedupedGroupPerson[] {
  const buckets = new Map<string, Candidate>();

  const bucketKeyFor = (c: Candidate): string => {
    if (c.userId) return `uid:${c.userId}`;
    if (c.email) return `email:${c.email}`;
    return `name:${normalizeName(c.displayName)}`;
  };

  const findExistingBucket = (c: Candidate): string | null => {
    if (c.userId && buckets.has(`uid:${c.userId}`)) return `uid:${c.userId}`;
    if (c.email && buckets.has(`email:${c.email}`)) return `email:${c.email}`;
    const nameKey = `name:${normalizeName(c.displayName)}`;
    if (buckets.has(nameKey)) return nameKey;
    return null;
  };

  for (const m of members) {
    if (m.user_id === excludeUserId) continue;
    const group = groupMap.get(m.group_id);
    if (!group) continue;

    const memberCount = memberCountByGroup.get(m.group_id) ?? 0;
    const candidate: Candidate = {
      displayName: m.display_name?.trim() || "Unknown",
      email: normalizeEmail(m.email),
      groupId: m.group_id,
      groupName: group.name,
      memberId: m.id,
      memberCount,
      userId: m.user_id ?? null,
    };

    const existingKey = findExistingBucket(candidate);
    if (existingKey) {
      const existing = buckets.get(existingKey)!;
      const merged = pickBetter(existing, candidate);
      buckets.delete(existingKey);
      buckets.set(bucketKeyFor(merged), merged);
      continue;
    }

    buckets.set(bucketKeyFor(candidate), candidate);
  }

  return Array.from(buckets.values())
    .map(({ userId: _u, ...person }) => person)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
