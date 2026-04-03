# Group Invite Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shareable invite links to groups so any member can copy a link, paste it in a group chat, and friends can join — whether or not they have Coconut.

**Architecture:** The invite URL (`coconut-app.dev/join/inv_xxx`) serves double duty: a Next.js landing page for browsers, and a Universal Link that opens the Coconut app when installed. Existing backend API routes (`/api/invite/[token]` and `/api/invite/[token]/join`) are enhanced with richer preview data. The mobile app gets a join screen, an invite button on the group detail, and pending-invite handling after auth.

**Tech Stack:** Next.js 14 (App Router), Expo Router, React Native, Supabase (Postgres), Clerk auth, Apple Universal Links (already configured).

**Existing infrastructure:**
- `groups.invite_token` column — populated on group creation (`inv_` + UUID)
- `GET /api/invite/[token]` — exists at `app/api/invite/[token]/route.ts`, returns minimal preview (groupName, memberCount, inviterName). Needs enhancement.
- `POST /api/invite/[token]/join` — exists at `app/api/invite/[token]/join/route.ts`, adds current user to group. Mostly complete.
- AASA at `.well-known/apple-app-site-association` already handles `/join/*` paths
- `join/[token]` route registered in mobile `_layout.tsx` (line 93, 120) but no screen file
- `lib/invite.ts` in coconut-app has `BASE_URL = "https://coconut-app.dev"` and share utilities
- `useToast` hook in `components/Toast.tsx`
- Middleware does NOT currently whitelist `/api/invite(.*)` or `/join(.*)` — needs fixing

---

### Task 1: Database migration — `joined_via` column

**Files:**
- Create: `docs/supabase-migration-joined-via.sql` (in coconut)

- [ ] **Step 1: Write the migration SQL**

Create `docs/supabase-migration-joined-via.sql`:

```sql
ALTER TABLE group_members
ADD COLUMN IF NOT EXISTS joined_via text DEFAULT 'added_by_owner';

COMMENT ON COLUMN group_members.joined_via IS 'How member joined: added_by_owner, invite_link, splitwise_import';
```

- [ ] **Step 2: Commit**

```bash
cd /Users/harshil.shah/coconut
git add docs/supabase-migration-joined-via.sql
git commit -m "feat: add joined_via column to group_members"
```

---

### Task 2: Middleware — whitelist public invite routes

**Files:**
- Modify: `middleware.ts` (in coconut)

The existing `GET /api/invite/[token]` is documented as public but not in the middleware whitelist. The landing page at `/join/*` also needs to be public.

- [ ] **Step 1: Add public routes**

In `middleware.ts`, add these two entries to the `isPublicRoute` array (after the existing entries):

```typescript
"/join(.*)",
"/api/invite(.*)",
```

Note: Only `GET /api/invite/[token]` is truly public — `POST /api/invite/[token]/join` still requires auth via `getUserId()` inside the route handler.

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/harshil.shah/coconut
git add middleware.ts
git commit -m "feat: whitelist /join and /api/invite routes in Clerk middleware"
```

---

### Task 3: Enhance existing preview API with rich data

**Files:**
- Modify: `app/api/invite/[token]/route.ts` (in coconut)

The existing endpoint returns only `groupName`, `memberCount`, `inviterName`. Enhance it to include member list (display names + initials), group type, and recent expenses.

- [ ] **Step 1: Update the preview endpoint**

Replace the contents of `app/api/invite/[token]/route.ts` with:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || !token.startsWith("inv_")) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  const db = getSupabase();

  const { data: group, error } = await db
    .from("groups")
    .select("id, name, owner_id, group_type")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !group) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const { data: members } = await db
    .from("group_members")
    .select("display_name, user_id")
    .eq("group_id", group.id)
    .order("created_at", { ascending: true });

  const ownerMember = (members ?? []).find((m) => m.user_id === group.owner_id);

  const { data: recentSplits } = await db
    .from("split_transactions")
    .select("description, amount")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false })
    .limit(3);

  return NextResponse.json({
    groupId: group.id,
    groupName: group.name,
    groupType: group.group_type ?? "other",
    memberCount: (members ?? []).length,
    inviterName: ownerMember?.display_name ?? "Someone",
    members: (members ?? []).map((m) => ({
      display_name: m.display_name,
      initial: m.display_name?.charAt(0)?.toUpperCase() ?? "?",
      is_owner: m.user_id === group.owner_id,
    })),
    recentExpenses: (recentSplits ?? [])
      .filter((s) => s.description && s.amount != null)
      .map((s) => ({
        description: s.description,
        amount: Number(s.amount),
      })),
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/harshil.shah/coconut
git add app/api/invite/\[token\]/route.ts
git commit -m "feat: enhance invite preview with members list and recent expenses"
```

---

### Task 4: Update join endpoint — add `joined_via` tracking + fix params

**Files:**
- Modify: `app/api/invite/[token]/join/route.ts` (in coconut)

Fix the Next.js 14 params pattern (`Promise<{ token: string }>`) and add `joined_via: 'invite_link'` to new member inserts.

- [ ] **Step 1: Update the join endpoint**

Replace the contents of `app/api/invite/[token]/join/route.ts` with:

```typescript
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!token || !token.startsWith("inv_")) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  const db = getSupabase();

  const { data: group, error: groupErr } = await db
    .from("groups")
    .select("id, name, owner_id")
    .eq("invite_token", token)
    .maybeSingle();

  if (groupErr || !group) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (group.owner_id === userId) {
    return NextResponse.json({
      joined: true,
      alreadyMember: true,
      groupId: group.id,
      groupName: group.name,
    });
  }

  const { data: existing } = await db
    .from("group_members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      joined: true,
      alreadyMember: true,
      groupId: group.id,
      groupName: group.name,
    });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const displayName = user?.fullName || user?.firstName || "Member";

  if (email) {
    const { data: placeholder } = await db
      .from("group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("email", email.toLowerCase())
      .is("user_id", null)
      .maybeSingle();

    if (placeholder) {
      await db
        .from("group_members")
        .update({ user_id: userId, display_name: displayName, joined_via: "invite_link" })
        .eq("id", placeholder.id);

      return NextResponse.json({
        joined: true,
        alreadyMember: false,
        groupId: group.id,
        groupName: group.name,
      });
    }
  }

  const { error: insertErr } = await db.from("group_members").insert({
    group_id: group.id,
    user_id: userId,
    display_name: displayName,
    email: email?.toLowerCase() ?? null,
    joined_via: "invite_link",
  });

  if (insertErr) {
    console.error("[invite/join] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to join group" }, { status: 500 });
  }

  return NextResponse.json({
    joined: true,
    alreadyMember: false,
    groupId: group.id,
    groupName: group.name,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/harshil.shah/coconut
git add app/api/invite/\[token\]/join/route.ts
git commit -m "feat: add joined_via tracking and fix params pattern in join endpoint"
```

---

### Task 5: Expose invite_token to all group members

**Files:**
- Modify: `app/api/groups/[id]/route.ts` (in coconut, ~line 34)
- Modify: `app/api/groups/route.ts` (in coconut, ~line 68)

Currently `invite_token` is only returned to the group owner. Any member needs it to share the invite link.

- [ ] **Step 1: Update group detail endpoint**

In `app/api/groups/[id]/route.ts`, find:
```typescript
const maskedGroup = { ...groupWithoutToken, invite_token: isOwner ? invite_token : null };
```
Replace with:
```typescript
const maskedGroup = { ...groupWithoutToken, invite_token: invite_token ?? null };
```

- [ ] **Step 2: Update group list endpoint**

In `app/api/groups/route.ts`, find:
```typescript
invite_token: g.owner_id === userId ? g.invite_token : null,
```
Replace with:
```typescript
invite_token: g.invite_token ?? null,
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/harshil.shah/coconut
git add app/api/groups/\[id\]/route.ts app/api/groups/route.ts
git commit -m "feat: expose invite_token to all group members"
```

---

### Task 6: Next.js invite landing page

**Files:**
- Create: `app/join/[token]/page.tsx` (in coconut)

Server-rendered page at `coconut-app.dev/join/[token]`. Shows trip preview with Coconut branding, member list, recent expenses, and CTA buttons. Also generates OG meta tags for rich link previews in iMessage/WhatsApp.

The landing page calls the internal preview API function directly (server component, no HTTP call needed), but the data shape matches `GET /api/invite/[token]`.

- [ ] **Step 1: Create the landing page**

Create `app/join/[token]/page.tsx`:

```tsx
import { Metadata } from "next";
import { getSupabase } from "@/lib/supabase";

const APP_STORE_URL = "https://apps.apple.com/app/coconut/id6744073908";
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://coconut-app.dev";

interface GroupPreview {
  name: string;
  groupType: string;
  creatorName: string;
  memberCount: number;
  members: Array<{ display_name: string; initial: string; is_owner: boolean }>;
  recentExpenses: Array<{ description: string; amount: number }>;
}

async function getGroupPreview(token: string): Promise<GroupPreview | null> {
  if (!token || !token.startsWith("inv_")) return null;
  const db = getSupabase();

  const { data: group } = await db
    .from("groups")
    .select("id, name, group_type, owner_id")
    .eq("invite_token", token)
    .single();

  if (!group) return null;

  const { data: members } = await db
    .from("group_members")
    .select("display_name, user_id")
    .eq("group_id", group.id)
    .order("created_at", { ascending: true });

  const ownerMember = (members ?? []).find((m) => m.user_id === group.owner_id);

  const { data: recentSplits } = await db
    .from("split_transactions")
    .select("description, amount")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false })
    .limit(3);

  return {
    name: group.name,
    groupType: group.group_type ?? "other",
    creatorName: ownerMember?.display_name ?? "Someone",
    memberCount: (members ?? []).length,
    members: (members ?? []).map((m) => ({
      display_name: m.display_name,
      initial: m.display_name?.charAt(0)?.toUpperCase() ?? "?",
      is_owner: m.user_id === group.owner_id,
    })),
    recentExpenses: (recentSplits ?? [])
      .filter((s) => s.description && s.amount != null)
      .map((s) => ({ description: s.description, amount: Number(s.amount) })),
  };
}

const GROUP_TYPE_EMOJI: Record<string, string> = {
  trip: "✈️", home: "🏠", couple: "💑", other: "👥",
};

const MEMBER_COLORS = ["#1F2328", "#6B7280", "#8B5CF6", "#F59E0B", "#4A6CF7", "#E8507A"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const group = await getGroupPreview(token);
  if (!group) return { title: "Coconut — Invite" };

  const emoji = GROUP_TYPE_EMOJI[group.groupType] ?? "";
  const title = `Join ${group.name} ${emoji} on Coconut`;
  const description = `${group.creatorName} invited you to split expenses. ${group.memberCount} member${group.memberCount !== 1 ? "s" : ""}.`;

  return {
    title,
    description,
    openGraph: { title, description, siteName: "Coconut", type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const group = await getGroupPreview(token);

  if (!group) {
    return (
      <div style={{
        fontFamily: "Inter, -apple-system, sans-serif",
        background: "#FAFAF9", minHeight: "100vh",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "24px",
      }}>
        <img src="/brand/coconut-mark.jpg" alt="Coconut" width={56} height={56}
          style={{ borderRadius: 14, marginBottom: 24 }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1F2328", marginBottom: 8 }}>
          Invalid invite link
        </h1>
        <p style={{ fontSize: 14, color: "#6B7280", textAlign: "center" }}>
          This invite link is no longer valid. Ask the group creator to share a new one.
        </p>
      </div>
    );
  }

  const emoji = GROUP_TYPE_EMOJI[group.groupType] ?? "";
  const joinUrl = `${SITE_URL}/join/${token}`;

  return (
    <div style={{
      fontFamily: "Inter, -apple-system, sans-serif",
      background: "#FAFAF9", minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "40px 24px 32px",
    }}>
      <img src="/brand/coconut-mark.jpg" alt="Coconut" width={56} height={56}
        style={{ borderRadius: 14, marginBottom: 24 }} />

      <div style={{
        background: "white", borderRadius: 20, padding: "28px 24px",
        width: "100%", maxWidth: 380, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 20,
      }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
            You&apos;re invited to
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#1F2328" }}>
            {group.name} {emoji}
          </div>
          <div style={{ fontSize: 14, color: "#777", marginTop: 6 }}>
            Created by <strong style={{ color: "#1F2328" }}>{group.creatorName}</strong>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #f0eeec", paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
            {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {group.members.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: MEMBER_COLORS[i % MEMBER_COLORS.length],
                  color: "white", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 600, flexShrink: 0,
                }}>
                  {m.initial}
                </div>
                <span style={{ fontSize: 14, color: "#1F2328", fontWeight: 500 }}>{m.display_name}</span>
                {m.is_owner && <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>Owner</span>}
              </div>
            ))}
          </div>
        </div>

        {group.recentExpenses.length > 0 && (
          <div style={{ borderTop: "1px solid #f0eeec", paddingTop: 16, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
              Recent activity
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {group.recentExpenses.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#555" }}>{e.description}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1F2328" }}>${e.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 10 }}>
        <a href={joinUrl} style={{
          background: "#1F2328", color: "white", borderRadius: 14, padding: 16,
          textAlign: "center", fontWeight: 600, fontSize: 16, textDecoration: "none", display: "block",
        }}>
          Open in Coconut
        </a>
        <a href={APP_STORE_URL} style={{
          background: "white", border: "1.5px solid #E3DBD8", color: "#1F2328",
          borderRadius: 14, padding: 16, textAlign: "center", fontWeight: 600,
          fontSize: 16, textDecoration: "none", display: "block",
        }}>
          Download Coconut
        </a>
      </div>

      <div style={{ fontSize: 12, color: "#aaa", marginTop: 16, textAlign: "center" }}>
        Split expenses with friends — no spreadsheets needed
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck and build**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/harshil.shah/coconut
git add app/join/\[token\]/page.tsx
git commit -m "feat: add invite landing page with OG tags for rich link previews"
```

---

### Task 7: Mobile — Join Group screen

**Files:**
- Create: `app/join/[token].tsx` (in coconut-app)

The route `join/[token]` is already registered in `app/_layout.tsx` (lines 93 and 120) with `presentation: "modal"`. We just need to create the screen file.

This screen fetches the group preview from the public API, shows the trip details, and has a "Join" button. For signed-out users, it stores the invite token and redirects to sign-in.

- [ ] **Step 1: Install AsyncStorage if not present**

Run: `cd /Users/harshil.shah/coconut-app && grep -q async-storage package.json && echo "exists" || npx expo install @react-native-async-storage/async-storage`

- [ ] **Step 2: Create the Join Group screen**

Create `coconut-app/app/join/[token].tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, DeviceEventEmitter,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useApiFetch } from "../../lib/api";
import { useTheme } from "../../lib/theme-context";
import { font, radii, shadow } from "../../lib/theme";

export const PENDING_INVITE_KEY = "coconut.pending_invite_token";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://coconut-app.dev";
const MEMBER_COLORS = ["#4A6CF7", "#E8507A", "#F59E0B", "#8B5CF6", "#64748B", "#334155"];
const GROUP_TYPE_EMOJI: Record<string, string> = {
  trip: "✈️", home: "🏠", couple: "💑", other: "👥",
};

interface GroupPreview {
  groupId: string;
  groupName: string;
  groupType: string;
  memberCount: number;
  inviterName: string;
  members: Array<{ display_name: string; initial: string; is_owner: boolean }>;
  recentExpenses: Array<{ description: string; amount: number }>;
}

export default function JoinGroupScreen() {
  const { theme } = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { isSignedIn, isLoaded } = useAuth();
  const apiFetch = useApiFetch();
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ alreadyMember: boolean; groupId: string } | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/invite/${token}`);
      if (!res.ok) { setError("This invite link is no longer valid."); return; }
      const data = await res.json();
      setPreview(data);
    } catch {
      setError("Couldn't load group info. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchPreview(); }, [fetchPreview]);

  useEffect(() => {
    if (!token || !isLoaded) return;
    if (!isSignedIn) { AsyncStorage.setItem(PENDING_INVITE_KEY, token); }
  }, [token, isLoaded, isSignedIn]);

  const handleJoin = async () => {
    if (!token || joining) return;
    if (!isSignedIn) {
      await AsyncStorage.setItem(PENDING_INVITE_KEY, token);
      router.replace("/(auth)/sign-in");
      return;
    }
    setJoining(true);
    try {
      const res = await apiFetch(`/api/invite/${token}/join`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to join group"); return; }
      setResult({ alreadyMember: data.alreadyMember, groupId: data.groupId });
      await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      DeviceEventEmitter.emit("groups-updated");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setJoining(false);
    }
  };

  const navigateToGroup = (groupId: string) => {
    router.replace({ pathname: "/(tabs)/shared/group", params: { id: groupId } });
  };

  if (loading) {
    return (
      <View style={[st.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (error && !preview) {
    return (
      <SafeAreaView style={[st.container, { backgroundColor: theme.background }]}>
        <View style={st.centered}>
          <View style={[st.iconCircle, { backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name="link-outline" size={32} color={theme.textQuaternary} />
          </View>
          <Text style={[st.title, { color: theme.text }]}>Invalid invite link</Text>
          <Text style={[st.subtitle, { color: theme.textTertiary }]}>
            This link is no longer valid. Ask the group creator for a new one.
          </Text>
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => router.back()} activeOpacity={0.7}
          >
            <Text style={st.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (result) {
    return (
      <SafeAreaView style={[st.container, { backgroundColor: theme.background }]}>
        <View style={st.centered}>
          <View style={[st.iconCircle, { backgroundColor: theme.primaryLight }]}>
            <Ionicons
              name={result.alreadyMember ? "people" : "checkmark-circle"}
              size={36} color={theme.primary}
            />
          </View>
          <Text style={[st.title, { color: theme.text }]}>
            {result.alreadyMember ? "Already a member" : "You're in!"}
          </Text>
          <Text style={[st.subtitle, { color: theme.textTertiary }]}>
            {result.alreadyMember
              ? `You're already in ${preview?.groupName ?? "this group"}.`
              : `You've joined ${preview?.groupName ?? "the group"}.`}
          </Text>
          <TouchableOpacity
            style={[st.primaryBtn, { backgroundColor: theme.primary }]}
            onPress={() => navigateToGroup(result.groupId)} activeOpacity={0.7}
          >
            <Text style={st.primaryBtnText}>View group</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const emoji = GROUP_TYPE_EMOJI[preview?.groupType ?? "other"] ?? "";

  return (
    <SafeAreaView style={[st.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={st.closeBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="close" size={24} color={theme.textTertiary} />
        </TouchableOpacity>

        <View style={[st.iconCircle, { backgroundColor: theme.primaryLight, marginBottom: 16 }]}>
          <Text style={{ fontSize: 32 }}>{emoji || "👥"}</Text>
        </View>

        <Text style={[st.label, { color: theme.textTertiary }]}>You're invited to</Text>
        <Text style={[st.groupName, { color: theme.text }]}>{preview?.groupName}</Text>
        <Text style={[st.createdBy, { color: theme.textTertiary }]}>
          Created by {preview?.inviterName}
        </Text>

        <View style={[st.card, { backgroundColor: theme.surface, borderColor: theme.borderLight }]}>
          <Text style={[st.cardLabel, { color: theme.textQuaternary }]}>
            {preview?.memberCount ?? 0} MEMBER{(preview?.memberCount ?? 0) !== 1 ? "S" : ""}
          </Text>
          {(preview?.members ?? []).map((m, i) => (
            <View key={i} style={[st.memberRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.borderLight }]}>
              <View style={[st.avatar, { backgroundColor: MEMBER_COLORS[i % MEMBER_COLORS.length] }]}>
                <Text style={st.avatarText}>{m.initial}</Text>
              </View>
              <Text style={[st.memberName, { color: theme.text }]}>{m.display_name}</Text>
              {m.is_owner && <Text style={[st.badge, { color: theme.textQuaternary }]}>Owner</Text>}
            </View>
          ))}
        </View>

        {(preview?.recentExpenses ?? []).length > 0 && (
          <View style={[st.card, { backgroundColor: theme.surface, borderColor: theme.borderLight }]}>
            <Text style={[st.cardLabel, { color: theme.textQuaternary }]}>RECENT ACTIVITY</Text>
            {(preview?.recentExpenses ?? []).map((e, i) => (
              <View key={i} style={[st.expenseRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.borderLight }]}>
                <Text style={[st.expenseDesc, { color: theme.textSecondary }]}>{e.description}</Text>
                <Text style={[st.expenseAmt, { color: theme.text }]}>${e.amount.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[st.bottomBar, { borderTopColor: theme.borderLight }]}>
        <TouchableOpacity
          style={[st.primaryBtn, { backgroundColor: theme.primary }]}
          onPress={handleJoin} disabled={joining} activeOpacity={0.7}
        >
          {joining
            ? <ActivityIndicator color="#fff" />
            : <Text style={st.primaryBtnText}>
                {isSignedIn ? `Join ${preview?.groupName ?? "group"}` : "Sign up to join"}
              </Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  scrollContent: { padding: 24, paddingTop: 16, paddingBottom: 120, alignItems: "center" },
  closeBtn: { alignSelf: "flex-end", padding: 4, marginBottom: 8 },
  iconCircle: { width: 64, height: 64, borderRadius: radii.xl, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontFamily: font.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  groupName: { fontSize: 24, fontWeight: "700", fontFamily: font.bold, marginBottom: 4, textAlign: "center" },
  createdBy: { fontSize: 14, fontFamily: font.regular, marginBottom: 24 },
  card: { width: "100%", borderRadius: radii.lg, padding: 16, marginBottom: 12, ...shadow.sm },
  cardLabel: { fontSize: 11, fontFamily: font.bold, letterSpacing: 0.5, marginBottom: 12 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: font.bold },
  memberName: { fontSize: 14, fontFamily: font.medium, flex: 1 },
  badge: { fontSize: 11, fontFamily: font.regular },
  expenseRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  expenseDesc: { fontSize: 13, fontFamily: font.regular, flex: 1 },
  expenseAmt: { fontSize: 13, fontWeight: "600", fontFamily: font.semibold },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    padding: 20, paddingBottom: 36, borderTopWidth: 1,
    backgroundColor: "rgba(245,243,242,0.95)",
  },
  primaryBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600", fontFamily: font.semibold },
  title: { fontSize: 20, fontWeight: "700", fontFamily: font.bold, marginBottom: 8, marginTop: 16 },
  subtitle: { fontSize: 14, fontFamily: font.regular, textAlign: "center", marginBottom: 24 },
});
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/harshil.shah/coconut-app && npx tsc --noEmit`
Expected: No new errors from this file

- [ ] **Step 4: Commit**

```bash
cd /Users/harshil.shah/coconut-app
git add 'app/join/[token].tsx'
git commit -m "feat: add Join Group screen for invite link deep links"
```

---

### Task 8: Mobile — Invite button on group detail

**Files:**
- Modify: `coconut-app/hooks/useGroups.ts` (add `invite_token` to `GroupDetail` type)
- Modify: `coconut-app/app/(tabs)/shared/group.tsx` (add invite button)

- [ ] **Step 1: Add invite_token to GroupDetail type**

In `coconut-app/hooks/useGroups.ts`, find the `GroupDetail` interface. After the `isOwner` field:

```typescript
isOwner?: boolean;
```

Add:
```typescript
invite_token?: string | null;
```

- [ ] **Step 2: Install expo-clipboard if not present**

Run: `cd /Users/harshil.shah/coconut-app && grep -q expo-clipboard package.json && echo "exists" || npx expo install expo-clipboard`

- [ ] **Step 3: Add invite button to group screen**

In `coconut-app/app/(tabs)/shared/group.tsx`:

Add to imports:
```typescript
import * as Clipboard from "expo-clipboard";
import { useToast } from "../../../components/Toast";
```

Inside `GroupScreen()` function, after the existing hook calls (after `const detail = ...` line), add:
```typescript
const toast = useToast();
```

After the closing `</View>` of the `s.groupHeader` block (after line 130 — the `</View>` that closes the header), add this JSX before the archived banner:

```tsx
{!isArchived && detail.invite_token ? (
  <TouchableOpacity
    style={[s.inviteBtn, { backgroundColor: theme.primary }]}
    onPress={async () => {
      await Clipboard.setStringAsync(`https://coconut-app.dev/join/${detail.invite_token}`);
      toast.show("Copied group invite link");
    }}
    activeOpacity={0.7}
  >
    <Ionicons name="link-outline" size={18} color="#fff" />
    <Text style={s.inviteBtnText}>Invite</Text>
  </TouchableOpacity>
) : null}
```

Add to `StyleSheet.create({...})`:
```typescript
inviteBtn: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  paddingVertical: 12,
  borderRadius: radii.md,
  marginBottom: 20,
},
inviteBtnText: {
  color: "#fff",
  fontSize: 15,
  fontWeight: "600",
  fontFamily: font.semibold,
},
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/harshil.shah/coconut-app && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
cd /Users/harshil.shah/coconut-app
git add hooks/useGroups.ts 'app/(tabs)/shared/group.tsx'
git commit -m "feat: add Invite button to group screen with clipboard copy"
```

---

### Task 9: Mobile — Pending invite after sign-in

**Files:**
- Modify: `coconut-app/app/_layout.tsx`

After sign-in or sign-up, check AsyncStorage for a pending invite token and navigate to the join screen.

- [ ] **Step 1: Add pending invite check to AuthSwitch**

In `coconut-app/app/_layout.tsx`:

Add import at top (alongside existing imports):
```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
```

Inside the `AuthSwitch()` function, add this `useEffect` after the existing `FORCE_SIGN_OUT` effect (after line ~84):

```typescript
useEffect(() => {
  if (!isLoaded || !isSignedIn || !setupHydrated) return;
  let cancelled = false;
  (async () => {
    try {
      const pendingToken = await AsyncStorage.getItem("coconut.pending_invite_token");
      if (cancelled || !pendingToken) return;
      await AsyncStorage.removeItem("coconut.pending_invite_token");
      setTimeout(() => {
        router.push({ pathname: "/join/[token]", params: { token: pendingToken } } as any);
      }, 500);
    } catch {}
  })();
  return () => { cancelled = true; };
}, [isLoaded, isSignedIn, setupHydrated]);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/harshil.shah/coconut-app && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
cd /Users/harshil.shah/coconut-app
git add app/_layout.tsx
git commit -m "feat: auto-join group from pending invite token after sign-in"
```

---

### Task 10: Web backend — full validation

**Files:** All coconut web changes from tasks 1-6

- [ ] **Step 1: Typecheck**

Run: `cd /Users/harshil.shah/coconut && npm run typecheck`
Expected: No errors

- [ ] **Step 2: Lint**

Run: `cd /Users/harshil.shah/coconut && npm run lint`
Expected: No errors (fix any issues)

- [ ] **Step 3: Tests**

Run: `cd /Users/harshil.shah/coconut && npm run test`
Expected: All existing tests pass

- [ ] **Step 4: Build**

Run: `cd /Users/harshil.shah/coconut && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Fix any issues found**

---

### Task 11: Mobile app — full validation and device test

**Files:** All coconut-app changes from tasks 7-9

- [ ] **Step 1: Typecheck**

Run: `cd /Users/harshil.shah/coconut-app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Build and run on device**

Run: `cd /Users/harshil.shah/coconut-app && npx expo run:ios --device`

- [ ] **Step 3: Manual test flow**

Test these scenarios:
1. Open a group → "Invite" button visible → tap → toast "Copied group invite link"
2. Open copied URL in Safari → landing page with members, expenses, CTAs
3. Tap "Open in Coconut" from Safari → app opens to join modal
4. Tap "Join" → success → navigate to group detail
5. Tap invite link again → "Already a member" → view group

- [ ] **Step 4: Fix any issues found**
