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

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  "https://coconut-app.dev";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Coconut — Personal finance with AI",
  description:
    "Search your spending in plain English, split and settle with friends, and manage money from the Coconut iPhone app.",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png", sizes: "32x32" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  /**
   * og:image / twitter:image come from `app/opengraph-image.png` + `app/twitter-image.png`
   * (same as `app/icon.png` — the coconut mark). File-based metadata is what Slack/Discord reliably use.
   */
  openGraph: {
    title: "Coconut — Personal finance with AI",
    description:
      "Search your spending in plain English, split and settle with friends, and manage money from the Coconut iPhone app.",
    url: "/",
    siteName: "Coconut",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coconut — Personal finance with AI",
    description:
      "Search your spending in plain English, split and settle with friends, and manage money from the Coconut iPhone app.",
  },
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
