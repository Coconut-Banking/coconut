export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";
import { getUserId } from "@/lib/auth";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/heic"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

function extForType(contentType: string): string {
  if (contentType === "image/png") return "png";
  return "jpg"; // jpeg and heic both stored as jpg
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing image field" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: png, jpeg, heic" },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Max 2MB" },
      { status: 400 }
    );
  }

  const ext = extForType(file.type);
  const path = `${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const admin = getSupabaseAdmin();

    const { error: uploadError } = await admin.storage
      .from("group-icons")
      .upload(path, buffer, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error("[group-icon] upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data: publicUrlData } = admin.storage
      .from("group-icons")
      .getPublicUrl(path);

    const imageUrl = publicUrlData.publicUrl;

    const { error: updateError } = await admin
      .from("groups")
      .update({ image_url: imageUrl })
      .eq("id", id);

    if (updateError) {
      console.error("[group-icon] db update error:", updateError);
      return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
    }

    return NextResponse.json({ imageUrl });
  } catch (err) {
    console.error("[group-icon] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const admin = getSupabaseAdmin();

    // Remove both possible extensions
    const { error: removeError } = await admin.storage
      .from("group-icons")
      .remove([`${id}.jpg`, `${id}.png`]);

    if (removeError) {
      console.error("[group-icon] storage remove error:", removeError);
    }

    const { error: updateError } = await admin
      .from("groups")
      .update({ image_url: null })
      .eq("id", id);

    if (updateError) {
      console.error("[group-icon] db update error:", updateError);
      return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[group-icon] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
