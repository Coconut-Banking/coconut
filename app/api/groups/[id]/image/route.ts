export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";
import { canAccessGroup } from "@/lib/group-access";

const MAX_BASE64_LENGTH = 2_000_000;

/**
 * Legacy endpoint — accepts a base64 data URI, uploads to Supabase Storage,
 * and stores the public URL (not the raw data URI) in groups.image_url.
 * New clients should use /api/groups/:id/icon (FormData upload) instead.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [userId, { id }] = await Promise.all([getUserId(), params]);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [allowed, rawBody] = await Promise.all([
    canAccessGroup(userId, id),
    req.json().catch(() => null) as Promise<{ image: string } | null>,
  ]);
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!rawBody) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const body = rawBody;

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
