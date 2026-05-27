import { LinkQrPanel } from "@/components/share/LinkQrPanel";
import { getAppUrl } from "@/lib/app-url";

type Props = { params: Promise<{ token: string }> };

export default async function CollectPage({ params }: Props) {
  const { token } = await params;
  const url = `${getAppUrl()}/collect/${encodeURIComponent(token)}`;
  return (
    <main className="min-h-screen bg-[#F5F3F2] px-4 py-12">
      <div className="mx-auto max-w-md">
        <LinkQrPanel url={url} title="Collect at table" subtitle="Pick your name to pay your share" />
      </div>
    </main>
  );
}
