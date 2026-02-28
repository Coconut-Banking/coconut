import { AppGate } from "@/components/AppGate";
import { AppLayout } from "@/components/AppLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AppGate>
      <AppLayout>{children}</AppLayout>
    </AppGate>
  );
}
