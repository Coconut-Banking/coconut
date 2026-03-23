import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Instrument_Sans, Syne } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Coconut — Personal finance with AI",
  description:
    "Search your spending in plain English, split and settle with friends, and manage money from the Coconut iPhone app.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${instrument.variable} ${syne.variable}`}>
        <body className="min-h-screen antialiased font-sans">{children}</body>
      </html>
    </ClerkProvider>
  );
}
