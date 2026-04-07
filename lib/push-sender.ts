import { getSupabaseAdmin } from "./supabase";

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: object;
  sound?: "default" | null;
  badge?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: object
): Promise<ExpoPushTicket> {
  const message: ExpoPushMessage = {
    to: expoPushToken,
    title,
    body,
    sound: "default",
    data,
  };

  const res = await fetch(EXPO_PUSH_API, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    console.error(
      `[push-sender] Expo Push API returned HTTP ${res.status} for token ${expoPushToken}`
    );
    return { status: "error", message: `HTTP ${res.status}` };
  }

  const result = await res.json();
  const ticket: ExpoPushTicket = result.data ?? result;

  if (ticket.status === "error") {
    console.error(
      `[push-sender] Error sending to ${expoPushToken}:`,
      ticket.message,
      ticket.details
    );
  }

  return ticket;
}

export async function sendPushNotificationBatch(
  tokens: string[],
  title: string,
  body: string,
  data?: object
): Promise<ExpoPushTicket[]> {
  if (tokens.length === 0) return [];

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: "default",
    data,
  }));

  const res = await fetch(EXPO_PUSH_API, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    console.error(
      `[push-sender] Expo Push API returned HTTP ${res.status} for batch of ${tokens.length} tokens`
    );
    return [];
  }

  const result = await res.json();
  return result.data ?? [];
}

/**
 * Send a push notification to all members of a group.
 * Optionally exclude a user (e.g. the person who triggered the action).
 */
export async function notifyGroupMembers(
  groupId: string,
  title: string,
  body: string,
  excludeUserId?: string,
  data?: object
): Promise<void> {
  const db = getSupabaseAdmin();

  const { data: group } = await db
    .from("groups")
    .select("owner_id")
    .eq("id", groupId)
    .single();

  const { data: members } = await db
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .not("user_id", "is", null);

  const userIds = new Set<string>();
  if (group?.owner_id) userIds.add(group.owner_id);
  for (const m of members ?? []) {
    if (m.user_id) userIds.add(m.user_id);
  }

  if (excludeUserId) {
    userIds.delete(excludeUserId);
  }

  if (userIds.size === 0) return;

  const { data: tokenRows } = await db
    .from("push_tokens")
    .select("token")
    .in("clerk_user_id", Array.from(userIds));

  const tokens = (tokenRows ?? []).map((r) => r.token).filter(Boolean);

  if (tokens.length === 0) {
    console.log(
      `[push-sender] No push tokens found for group ${groupId} members`
    );
    return;
  }

  const tickets = await sendPushNotificationBatch(
    tokens,
    title,
    body,
    data
  );

  const errors = tickets.filter((t) => t.status === "error");
  if (errors.length > 0) {
    console.warn(
      `[push-sender] ${errors.length}/${tickets.length} notifications failed for group ${groupId}`
    );
  }
}
