import { Suspense } from "react";
import { PayLinkCheckoutClient } from "./PayLinkCheckoutClient";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string }>;
};

export default async function PayLinkPage({ params, searchParams }: PageProps) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken);
  const sp = await searchParams;

  return (
    <main className="min-h-screen bg-[#F5F3F2] px-4 py-12">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">Coconut</p>
          <h1 className="mt-2 text-2xl font-bold text-[#1e2021]">Settle up</h1>
        </div>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          }
        >
          <PayLinkCheckoutClient
            token={token}
            initialPaid={sp.paid === "1"}
            initialCancelled={sp.cancelled === "1"}
          />
        </Suspense>
      </div>
    </main>
  );
}
