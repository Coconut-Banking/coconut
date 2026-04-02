import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { hasGmailModifyScope } from "@/lib/google-auth";

/** Returns whether the user needs to re-authorize Gmail to get gmail.modify scope. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasModify = await hasGmailModifyScope(userId);
  return NextResponse.json({ needsReauth: !hasModify });
}
