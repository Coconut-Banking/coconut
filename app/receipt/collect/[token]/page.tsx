import { Suspense } from "react";
import { ReceiptCollectClient } from "./ReceiptCollectClient";

type Props = { params: Promise<{ token: string }> };

export default async function ReceiptCollectPage({ params }: Props) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-[#F5F3F2] px-4 py-8">
      <div className="mx-auto max-w-md">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          }
        >
          <ReceiptCollectClient token={decodeURIComponent(token)} />
        </Suspense>
      </div>
    </main>
  );
}
