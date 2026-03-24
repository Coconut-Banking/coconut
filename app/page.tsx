import Script from "next/script";
import { CoconutMobileMarketingPage } from "@/components/landing/CoconutMobileMarketingPage";

const COCONUT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Coconut",
  applicationCategory: "FinanceApplication",
  operatingSystem: "iOS",
  description:
    "Coconut is an iPhone app to link bank accounts with Plaid (read-only), split shared expenses with friends and groups, scan receipts into line items, search transactions in plain language, settle balances, and accept in-person contactless payments with Tap to Pay on iPhone (Stripe).",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
} as const;

export default function LandingPage() {
  return (
    <>
      <Script
        id="coconut-software-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(COCONUT_JSON_LD) }}
      />
      <CoconutMobileMarketingPage />
    </>
  );
}
