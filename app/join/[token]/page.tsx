import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Users, ArrowRight } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

async function getInviteData(token: string) {
  if (!token.startsWith("inv_")) return null;

  const db = getSupabase();
  const { data: group } = await db
    .from("groups")
    .select("id, name, owner_id, image_url")
    .eq("invite_token", token)
    .maybeSingle();

  if (!group) return null;

  const { count } = await db
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id);

  let inviterName = "Someone";
  try {
    const clerk = await clerkClient();
    const owner = await clerk.users.getUser(group.owner_id);
    inviterName = owner.fullName || owner.firstName || "Someone";
  } catch {
    /* non-critical */
  }

  return {
    groupName: group.name,
    imageUrl: (group as { image_url?: string | null }).image_url ?? null,
    memberCount: count ?? 0,
    inviterName,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getInviteData(token);
  if (!data) return { title: "Coconut" };

  const title = `Join ${data.groupName} on Coconut`;
  const description = `${data.inviterName} invited you to ${data.groupName} — ${data.memberCount} member${data.memberCount !== 1 ? "s" : ""}. Split expenses the easy way.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Coconut",
      type: "website",
      images: [{ url: "https://coconut-app.dev/brand/coconut-mark.jpg", alt: "Coconut" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["https://coconut-app.dev/brand/coconut-mark.jpg"],
    },
  };
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getInviteData(token);
  if (!data) notFound();

  const deepLink = `coconut://join/${token}`;
  const appStoreUrl = "https://apps.apple.com/app/coconut-banking/id6742188498";

  return (
    <div className="min-h-screen bg-[#F5F3F2] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          {data.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.imageUrl} alt="" className="w-16 h-16 rounded-full mx-auto mb-5 object-cover" />
          ) : (
            <div className="w-14 h-14 bg-[#1e2021] rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Users size={24} className="text-white" />
            </div>
          )}

          <p className="text-sm text-gray-500 mb-1">
            {data.inviterName} invited you to
          </p>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {data.groupName}
          </h1>
          <p className="text-sm text-gray-400 mb-8">
            {data.memberCount} {data.memberCount === 1 ? "member" : "members"}
          </p>

          <a
            href={deepLink}
            className="flex items-center justify-center gap-2 w-full bg-[#1e2021] hover:bg-[#161819] text-white py-3 px-5 rounded-xl text-sm font-medium transition-colors mb-3"
          >
            Open in Coconut
            <ArrowRight size={16} />
          </a>

          <a
            href={appStoreUrl}
            className="block text-sm text-gray-500 hover:text-gray-700 transition-colors py-2"
          >
            Don&apos;t have the app? Download it
          </a>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Coconut — the fastest way to split expenses
        </p>
      </div>
    </div>
  );
}
