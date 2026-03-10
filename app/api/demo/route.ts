import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo";

/** POST /api/demo — enter demo mode (disabled in production) */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Demo mode is not available" }, { status: 403 });
  }

  const res = NextResponse.json({ demo: true });
  res.cookies.set(DEMO_COOKIE, "true", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: String(process.env.NODE_ENV) === "production",
    maxAge: 60 * 60 * 24,
  });
  return res;
}

/** DELETE /api/demo — exit demo mode */
export async function DELETE() {
  const res = NextResponse.json({ demo: false });
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
