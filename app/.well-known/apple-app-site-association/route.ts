export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() || "942BUGUD75";

  const aasa = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${teamId}.com.coconut.app`, `${teamId}.com.coconut.app.dev`],
          paths: ["/plaid-oauth*", "/join/*"],
        },
      ],
    },
  };

  return NextResponse.json(aasa, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
