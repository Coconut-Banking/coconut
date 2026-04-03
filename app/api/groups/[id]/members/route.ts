export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { findClerkUserIdByEmail } from "@/lib/clerk-user-lookup";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const displayName = (body.displayName ?? body.display_name ?? "").trim().slice(0, 100);
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

  // Check for existing member to prevent duplicates
  let existingQuery = db.from("group_members").select("id, display_name, email").eq("group_id", id);
  if (email) {
    existingQuery = existingQuery.eq("email", email);
  } else {
    existingQuery = existingQuery.is("email", null).eq("display_name", displayName);
  }
  const { data: existingMember } = await existingQuery.maybeSingle();
  if (existingMember) {
    return NextResponse.json(existingMember);
  }

  let linkedUserId: string | null = null;
  if (email) {
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
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabase();

  // Check the user owns the group or is a member
  const { data: group } = await db.from("groups").select("owner_id").eq("id", id).single();
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (group.owner_id !== userId) {
    const { data: membership } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", id)
      .eq("user_id", userId)
      .single();
    if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: members, error } = await db
    .from("group_members")
    .select("id, display_name, email, user_id, venmo_username, cashapp_cashtag, paypal_username")
    .eq("group_id", id);

  if (error) {
    console.error("[members] list:", error.message);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
  return NextResponse.json(members);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { memberId, venmo_username, cashapp_cashtag, paypal_username } = body;
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
