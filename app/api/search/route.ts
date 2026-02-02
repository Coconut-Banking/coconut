import { NextRequest, NextResponse } from "next/server";
import { searchTransactions } from "@/lib/search";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 50);
  const results = searchTransactions(q, limit);
  return NextResponse.json(results);
}
