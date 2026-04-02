import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getAutoArchivePreference, setAutoArchivePreference, hasGmailModifyScope } from "@/lib/google-auth";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [enabled, hasModify] = await Promise.all([
    getAutoArchivePreference(userId),
    hasGmailModifyScope(userId),
  ]);

  return NextResponse.json({ enabled, needsReauth: enabled && !hasModify });
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { enabled: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  await setAutoArchivePreference(userId, body.enabled);

  // If enabling, check if they have the required scope
  const needsReauth = body.enabled ? !(await hasGmailModifyScope(userId)) : false;

  return NextResponse.json({ enabled: body.enabled, needsReauth });
}
