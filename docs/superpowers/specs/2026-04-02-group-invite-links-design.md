# Group Invite Links

**Date:** 2026-04-02
**Status:** Ready for planning

## Problem

When you create a trip or group in Coconut, there's no easy way to share it. You have to manually add people by email. If you're in a group chat planning a trip, you should be able to drop a link and everyone joins — whether they have Coconut or not.

Splitwise has invite links but they're buried in group settings and the non-user experience is poor. We can do better.

## Solution

A shareable invite link for any group. Tap "Invite" on the group screen → link copies to clipboard → paste it in your group chat. People with Coconut tap it and the app opens to a "Join" screen. People without Coconut see a landing page with trip details, download the app, and join after.

## User Flows

### Flow 1: Sharing the invite link

Any group member, on the group detail screen in the mobile app:

1. Tap the **"Invite"** button (prominent, top of group screen — not buried in settings)
2. Link is copied to clipboard: `https://coconut-app.dev/join/inv_xxx`
3. Toast appears: **"Copied group invite link"**
4. Paste it in iMessage, WhatsApp, whatever

The invite URL includes Open Graph meta tags so it renders a rich preview in chat apps: trip name, member count, Coconut branding with the coconut mark icon.

### Flow 2: Existing Coconut user taps the link

1. Tap the link → Universal Link fires → Coconut app opens
2. App navigates to a **Join Group** screen showing: trip name, group type emoji, creator, member list
3. Tap **"Join"** → `POST /api/groups/join` → added as a member → navigate to group detail
4. If already a member → show **"You're already in this trip"** with a button to view the group

### Flow 3: New user taps the link (no Coconut installed)

1. Tap the link → Safari opens the landing page at `coconut-app.dev/join/[token]`
2. Landing page shows a rich preview: Coconut mark, trip name, creator, member avatars/initials, member count, recent 2-3 expenses (description + amount)
3. Two CTAs: **"Open in Coconut"** (Universal Link) and **"Download Coconut"** (App Store link)
4. User taps "Download Coconut" → App Store → installs → comes back to Safari (tab persists)
5. Taps **"Open in Coconut"** → Universal Link fires → app opens to Join Group screen
6. App detects user isn't signed in → stores invite token in AsyncStorage → shows group in **read-only mode**
7. User can browse the group: see expenses, members, balances — but **cannot** add expenses, settle up, or perform any mutations
8. Prominent nudge: **"Sign up to add expenses"** — tapping it starts the auth flow
9. After sign-up → pending invite token is read from AsyncStorage → auto-join → full access to the group

The read-only mode lets new users see the value before committing to sign up. They see what their friends have been splitting and are nudged to participate.

## Technical Design

### Infrastructure already in place

- `groups.invite_token` column exists — populated on group creation (`inv_` + UUID)
- Apple App Site Association at `.well-known/apple-app-site-association` already handles `/join/*` paths
- Expo config has `applinks:coconut-app.dev` in associated domains
- `CoconutMark` component exists in both repos (`/brand/coconut-mark.jpg`)

### Database changes

**Migration: add `joined_via` to `group_members`**

```sql
ALTER TABLE group_members
ADD COLUMN joined_via text DEFAULT 'added_by_owner';
```

Values: `'added_by_owner'`, `'invite_link'`, `'splitwise_import'`. Tracks how each member joined. Existing rows get backfilled to `'added_by_owner'` via the default.

No new tables needed.

### API routes

#### `GET /api/groups/invite/[token]` (public, no auth)

Returns group preview data for the landing page and the app's Join screen.

Response:
```json
{
  "group": {
    "name": "Cabo Trip 2026",
    "group_type": "trip",
    "creator_name": "Harshil",
    "member_count": 4,
    "members": [
      { "display_name": "Harshil", "initial": "H", "is_owner": true },
      { "display_name": "Mike", "initial": "M", "is_owner": false },
      { "display_name": "Sarah", "initial": "S", "is_owner": false }
    ],
    "recent_expenses": [
      { "description": "Airbnb deposit", "amount": 450.00 },
      { "description": "Flight tickets", "amount": 1200.00 }
    ]
  }
}
```

No sensitive data: no emails, no user IDs, no balances per person. Just enough to make the preview rich.

Recent expenses: last 3 split transactions for the group, description + amount only.

#### `POST /api/groups/join` (authenticated)

Body: `{ "invite_token": "inv_xxx" }`

Logic:
1. Look up group by `invite_token`
2. If group not found → 404
3. Get the authenticated user's ID and email
4. Check if user is already a member (`group_members` where `user_id` or `email` matches) → 409 `{ "error": "already_member", "group_id": "..." }`
5. Insert into `group_members` with `user_id`, `display_name` (from Clerk), `email`, `joined_via: 'invite_link'`
6. Return 200 with group details

#### `GET /api/groups/[id]` (modified)

Expose `invite_token` to **all members** of the group, not just the owner. Any member can share.

### Next.js landing page

**Route:** `app/join/[token]/page.tsx`

Server-rendered page. Fetches group preview data directly from Supabase (server component).

Layout:
- Coconut mark icon (rounded, `coconut-mark.jpg`) centered at top
- "You're invited to" label
- **Trip name** (large, bold) with group type emoji
- "Created by **[Name]**"
- Member list: avatar circles with initials, display names, "Owner" badge
- Recent expenses: 2-3 line items with description and amount
- **"Open in Coconut"** button (primary, `#1e2021`) — links to the same URL, Universal Link intercepts when app is installed
- **"Download Coconut"** button (secondary, outlined) — App Store link
- Footer tagline: "Split expenses with friends"

**Open Graph meta tags:**
```html
<meta property="og:title" content="Join Cabo Trip 2026 on Coconut" />
<meta property="og:description" content="Harshil invited you to split expenses. 4 members." />
<meta property="og:image" content="[coconut branded OG image]" />
```

The OG image can be a static Coconut-branded card initially. A dynamic OG image (generated per group with the trip name) is a nice-to-have follow-up.

### Mobile app (coconut-app) changes

#### Deep link handling

The app already has associated domains configured. We need to handle the `/join/[token]` URL path in the Expo Router linking config:

1. Register a route or listener for `coconut-app.dev/join/*` URLs
2. Extract the invite token from the URL
3. Route to the Join Group screen

#### New screen: Join Group

Shown when the app opens via an invite link.

**Authenticated user:**
- Fetch group preview from `GET /api/groups/invite/[token]`
- Display: trip name, type emoji, creator, member list
- **"Join [Trip Name]"** button → `POST /api/groups/join` → navigate to group detail
- If API returns 409 (already member) → show "You're already in this trip" + "View group" button

**Unauthenticated user (read-only mode):**
- Store invite token in AsyncStorage
- Fetch group preview from `GET /api/groups/invite/[token]` (public endpoint)
- Show the group in a read-only view: the same data as the public preview (member list, recent expense descriptions + amounts) — no per-person balances, no emails, no user IDs. All action buttons are disabled.
- Persistent banner or floating button: **"Sign up to add expenses"**
- On sign-up completion → read token from AsyncStorage → `POST /api/groups/join` → navigate to group as full member → clear stored token

#### Invite button on group detail screen

On the group detail screen (for any member):

- Prominent **"Invite"** button near the top (e.g. next to the group name or in the header actions)
- On tap: `Clipboard.setStringAsync(\`https://coconut-app.dev/join/${group.invite_token}\`)` → show toast "Copied group invite link"
- Uses the existing `invite_token` from the group data (already fetched, now exposed to all members)

### Security considerations

- The public preview endpoint (`/api/groups/invite/[token]`) exposes only display names, initials, expense descriptions, and amounts. No emails, no user IDs, no personal balances.
- Invite tokens are unguessable (`inv_` + UUID without hyphens = 32 hex chars).
- Rate limiting on the public endpoint is recommended to prevent enumeration.
- The join endpoint requires authentication, preventing anonymous abuse.
- Read-only mode for unauthenticated users shows the same limited data as the public preview — no more.

### Error handling

| Scenario | Behavior |
|----------|----------|
| Invalid or unknown token | Landing page: "This invite link is invalid." App: error screen with back button. |
| Already a member | App: "You're already in this trip" + navigate to group |
| Network error on join | App: retry prompt |
| Group deleted after link shared | Same as invalid token |

## What's NOT in scope

- Web app UI for viewing/managing groups (mobile only)
- Link expiration or regeneration (link lives forever, any member can share)
- Custom invite messages or personalization in the link
- Dynamic OG images per group (static Coconut-branded image for now)
- Android App Links setup (iOS Universal Links first, Android follows same pattern)

## File inventory (estimated changes)

### coconut (web backend)
- `app/join/[token]/page.tsx` — new landing page
- `app/api/groups/invite/[token]/route.ts` — new public preview endpoint
- `app/api/groups/join/route.ts` — new join endpoint
- `app/api/groups/[id]/route.ts` — expose `invite_token` to all members
- `docs/supabase-migration-joined-via.sql` — migration for `joined_via` column

### coconut-app (mobile)
- `app/join/[token].tsx` (or equivalent deep link handler) — Join Group screen
- `app/(tabs)/shared/group.tsx` — add Invite button + clipboard toast
- `lib/api.ts` or new `lib/invite.ts` — API calls for preview + join
- `lib/auth.ts` or `app/setup.tsx` — check for pending invite token after auth
- Deep link config update in `app.config.js` or linking config
