import { clerkClient } from "@clerk/nextjs/server";
import { isClerkRateLimitError } from "@/lib/auth";

/**
 * Look up a Clerk user ID by email address.
 * Returns the user's Clerk ID if found, null otherwise.
 */
export async function findClerkUserIdByEmail(
  email: string
): Promise<string | null> {
  try {
    const client = await clerkClient();
    const result = await client.users.getUserList({
      emailAddress: [email.toLowerCase()],
      limit: 1,
    });
    if (result.data.length > 0) {
      return result.data[0].id;
    }
    return null;
  } catch (e) {
    console.warn("[clerk-user-lookup] failed for", email, e);
    return null;
  }
}

/**
 * Batch look up Clerk user IDs for multiple emails.
 * Returns a Map of email -> clerkUserId for found users.
 * Emails with no matching Clerk account are omitted from the map.
 */
export async function findClerkUserIdsByEmails(
  emails: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (emails.length === 0) return result;

  const unique = [...new Set(emails.map((e) => e.toLowerCase()))];

  try {
    const client = await clerkClient();
    // Clerk supports up to 100 email addresses per getUserList call
    const BATCH_SIZE = 100;
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batch = unique.slice(i, i + BATCH_SIZE);
      const res = await client.users.getUserList({
        emailAddress: batch,
        limit: BATCH_SIZE,
      });
      for (const user of res.data) {
        const primaryEmail =
          user.primaryEmailAddress?.emailAddress?.toLowerCase();
        if (primaryEmail) {
          result.set(primaryEmail, user.id);
        }
        for (const ea of user.emailAddresses) {
          const addr = ea.emailAddress?.toLowerCase();
          if (addr && !result.has(addr)) {
            result.set(addr, user.id);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[clerk-user-lookup] batch lookup failed:", e);
  }

  return result;
}

/**
 * Batch-fetch Clerk profile photo URLs for a list of Clerk user IDs.
 * Returns a map of userId -> imageUrl. Handles rate limits gracefully.
 */
export async function getClerkUserPhotos(
  userIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return result;

  try {
    const client = await clerkClient();
    const BATCH_SIZE = 100;
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batch = unique.slice(i, i + BATCH_SIZE);
      const res = await client.users.getUserList({
        userId: batch,
        limit: BATCH_SIZE,
      });
      for (const user of res.data) {
        if (user.imageUrl) {
          result.set(user.id, user.imageUrl);
        }
      }
    }
  } catch (e) {
    if (isClerkRateLimitError(e)) {
      console.warn("[clerk-user-lookup] rate limited fetching photos");
    } else {
      console.warn("[clerk-user-lookup] photo batch lookup failed:", e);
    }
  }

  return result;
}
