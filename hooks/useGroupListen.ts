"use client";

import { useEffect, useRef } from "react";

/**
 * Subscribe to group changes via SSE. Refetches only when the DB changes.
 * Replaces polling with interrupt-style updates.
 */
export function useGroupListen(
  groupId: string | null,
  onUpdate: () => void
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!groupId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource(`/api/groups/${groupId}/listen`);

      es.addEventListener("message", (e: MessageEvent) => {
        if (e.data === "update" || e.data === "connected") {
          onUpdateRef.current();
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [groupId]);
}
