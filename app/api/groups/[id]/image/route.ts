export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { canAccessGroup } from "@/lib/group-access";

const MAX_BASE64_LENGTH = 2_000_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { image: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { image } = body;
  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "image (base64 data URI) required" }, { status: 400 });
  }

  if (image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "Image too large (max ~1.5MB)" }, { status: 413 });
  }

  const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: "Invalid data URI format" }, { status: 400 });
  }

  const contentType = match[1];
  const base64Data = match[2];
  const ext = contentType === "image/png" ? "png" : "jpg";
  const buffer = Buffer.from(base64Data, "base64");

  const admin = getSupabaseAdmin();
  const storagePath = `${id}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from("group-icons")
    .upload(storagePath, buffer, { contentType, upsert: true });

  if (uploadError) {
    console.error("[groups/image] storage upload error:", uploadError);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage
    .from("group-icons")
    .getPublicUrl(storagePath);

  const imageUrl = publicUrlData.publicUrl;

  const { error: updateError } = await admin
    .from("groups")
    .update({ image_url: imageUrl })
    .eq("id", id);

  if (updateError) {
    console.error("[groups/image] db update error:", updateError.message);
    return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, imageUrl });
}
