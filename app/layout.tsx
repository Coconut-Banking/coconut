import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coconut — Personal finance with AI",
  description: "Rocket Money–style visibility, semantic search, and AI to learn from your data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
