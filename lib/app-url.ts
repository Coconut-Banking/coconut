/** Canonical app origin for links (pay pages, Stripe redirects). */
export function getAppUrl(): string {
  const raw = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://coconut-app.dev";
  const trimmed = raw.replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}
