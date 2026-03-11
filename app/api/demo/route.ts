import { NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";

/** POST /api/demo — enter demo mode (requires DEMO_ENABLED=true, disabled in production) */
export async function POST(req: NextRequest) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ENABLED !== "true"
  ) {
    return NextResponse.json({ error: "Demo mode is not available" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`demo:${ip}`, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
