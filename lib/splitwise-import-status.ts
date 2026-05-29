import type { SupabaseClient } from "@supabase/supabase-js";

export type SplitwiseImportStatus = {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
  importedSplitwiseGroupCount: number;
  /** True when the user has finished a one-time import (has Splitwise groups or import_completed_at). */
  importCompleted: boolean;
  /** When the one-time import finished (stored or inferred from earliest imported group). */
  importCompletedAt: string | null;
};

type Db = SupabaseClient;

export async function getSplitwiseImportStatus(
  db: Db,
  userId: string,
  configured: boolean
): Promise<SplitwiseImportStatus> {
  if (!configured) {
    return {
      configured: false,
      connected: false,
      connectedAt: null,
      importedSplitwiseGroupCount: 0,
      importCompleted: false,
      importCompletedAt: null,
    };
  }

  const [tokenRes, importCountRes, earliestGroupRes] = await Promise.all([
    db
      .from("splitwise_tokens")
      .select("created_at, import_completed_at")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    db
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .eq("source", "splitwise"),
    db
      .from("groups")
      .select("created_at")
      .eq("owner_id", userId)
      .eq("source", "splitwise")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const token = tokenRes.data;
  const importCount = importCountRes.count ?? 0;
  const importCompletedAt =
    token?.import_completed_at ??
    (importCount > 0 ? (earliestGroupRes.data?.created_at as string | null) ?? null : null);
  const importCompleted = importCount > 0 || !!token?.import_completed_at;

  return {
    configured: true,
    connected: !!token,
    connectedAt: token?.created_at ?? null,
    importedSplitwiseGroupCount: importCount,
    importCompleted,
    importCompletedAt,
  };
}

export function splitwiseImportAlreadyCompletedMessage(
  importCompletedAt: string | null
): string {
  const datePart = importCompletedAt
    ? ` on ${new Date(importCompletedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : "";
  return `Splitwise was already imported${datePart}. This is a one-time import — clear imported data in Settings if you need to run it again.`;
}
