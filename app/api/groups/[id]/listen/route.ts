import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canAccessGroup } from "@/lib/group-access";

/**
 * GET /api/groups/[id]/listen
 * Server-Sent Events stream — pushes "update" only when split_transactions
 * or settlements change for this group. Client refetches on event.
 * Replaces polling with interrupt-style updates.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const allowed = await canAccessGroup(userId, id);
  if (!allowed) return new Response("Not found", { status: 404 });

  const db = getSupabase();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`${data}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      const channel = db
        .channel(`group-${id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "split_transactions",
            filter: `group_id=eq.${id}`,
          },
          () => send("data: update")
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "settlements",
            filter: `group_id=eq.${id}`,
          },
          () => send("data: update")
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "group_members",
            filter: `group_id=eq.${id}`,
          },
          () => send("data: update")
        )
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") send("data: connected");
          if (status === "CHANNEL_ERROR" && err) {
            console.warn("[listen] channel error:", err);
          }
        });

      req.signal?.addEventListener("abort", () => {
        channel.unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
