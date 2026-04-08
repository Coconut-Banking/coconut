export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { findClerkUserIdByEmail } from "@/lib/clerk-user-lookup";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params + body parse (independent)
  const [userId, { id }, bodyRaw] = await Promise.all([
    getUserId(),
    params,
    req.json().catch(() => null),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (bodyRaw === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const body = bodyRaw as Record<string, unknown>;
  const displayName = ((body.displayName ?? body.display_name ?? "") as string).trim().slice(0, 100);
  const email = (body.email as string)?.trim()?.toLowerCase() || null;

  if (!displayName) return NextResponse.json({ error: "displayName required" }, { status: 400 });

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const db = getSupabase();

  const { data: group, error: groupError } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (groupError || !group || group.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Link by explicit user_id hint first, then fall back to email lookup
  const hintUserId = typeof body.userId === "string" ? body.userId.trim() : null;
  let linkedUserId: string | null = hintUserId || null;
  if (!linkedUserId && email) {
    linkedUserId = await findClerkUserIdByEmail(email);
  }

  const { data: member, error } = await db
    .from("group_members")
    .insert({
      group_id: id,
      user_id: linkedUserId,
      email,
      display_name: displayName,
    })
    .select()
    .single();

  if (error) {
    console.error("[members] insert:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  return NextResponse.json(member);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params (independent)
  const [userId, { id }] = await Promise.all([getUserId(), params]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  // Single parallel access check: ownership OR membership
  const [{ data: group }, { data: membership }] = await Promise.all([
    db.from("groups").select("owner_id").eq("id", id).maybeSingle(),
    db.from("group_members").select("id").eq("group_id", id).eq("user_id", userId).maybeSingle(),
  ]);

  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (group.owner_id !== userId && !membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: members, error } = await db
    .from("group_members")
    .select("id, display_name, email, user_id, venmo_username, cashapp_cashtag, paypal_username")
    .eq("group_id", id);

  if (error) {
    console.error("[members] list:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  return NextResponse.json(
    { members: members ?? [] },
    { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params + body parse (independent)
  const [userId, { id }, bodyRaw] = await Promise.all([
    getUserId(),
    params,
    req.json().catch(() => null),
  ]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (bodyRaw === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const body = bodyRaw as Record<string, unknown>;
  const { memberId, venmo_username, cashapp_cashtag, paypal_username } = body as {
    memberId?: string;
    venmo_username?: string | null;
    cashapp_cashtag?: string | null;
    paypal_username?: string | null;
  };
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  const db = getSupabase();

  const { data: group, error: groupError } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (groupError || !group || group.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Validate and sanitize payment handles
  const HANDLE_MAX_LENGTH = 100;
  const HANDLE_PATTERN = /^[a-zA-Z0-9_\-.@]*$/;

  const handleFields = { venmo_username, cashapp_cashtag, paypal_username } as Record<string, unknown>;
  const updates: Record<string, string | null> = {};

  for (const [key, raw] of Object.entries(handleFields)) {
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      updates[key] = null;
      continue;
    }
    const trimmed = String(raw).trim();
    if (trimmed.length > HANDLE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `${key} must be ${HANDLE_MAX_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }
    if (!HANDLE_PATTERN.test(trimmed)) {
      return NextResponse.json(
        { error: `${key} contains invalid characters (only letters, numbers, _ - . @ allowed)` },
        { status: 400 }
      );
    }
    updates[key] = trimmed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: member, error } = await db
    .from("group_members")
    .update(updates)
    .eq("id", memberId)
    .eq("group_id", id)
    .select()
    .single();

  if (error) {
    console.error("[members] update:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json(member);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Parallelize auth + params (independent)
  const [userId, { id }] = await Promise.all([getUserId(), params]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabase();

  const [{ data: group, error: groupError }, { data: membership, error: membershipError }] = await Promise.all([
    db.from("groups").select("owner_id").eq("id", id).single(),
    db.from("group_members").select("id").eq("group_id", id).eq("user_id", userId).maybeSingle(),
  ]);
  if (groupError || !group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (group.owner_id === userId) {
    return NextResponse.json(
      { error: "Group owner cannot leave; archive or delete the group instead" },
      { status: 400 }
    );
  }
  if (membershipError) {
    console.error("[members] leave lookup:", membershipError.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: deleteError } = await db
    .from("group_members")
    .delete()
    .eq("group_id", id)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("[members] leave delete:", deleteError.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
