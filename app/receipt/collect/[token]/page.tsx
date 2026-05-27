import { ReceiptCollectClient } from "./ReceiptCollectClient";

type Props = { params: Promise<{ token: string }> };

export default async function ReceiptCollectPage({ params }: Props) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-[#F5F3F2] px-4 py-8">
      <div className="mx-auto max-w-md">
        <ReceiptCollectClient token={decodeURIComponent(token)} />
      </div>
    </main>
  );
}
