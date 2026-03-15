/**
 * Allowlist of known merchants → domain for favicon.
 * Only these show actual logos; others use letter avatars.
 * Matches case-insensitively on merchant name.
 */
const MERCHANT_DOMAINS: Record<string, string> = {
  lyft: "lyft.com",
  uber: "uber.com",
  tesla: "tesla.com",
  apple: "apple.com",
  starbucks: "starbucks.com",
  amazon: "amazon.com",
  zelle: "zelle.com",
  clipper: "clippercard.com",
  netflix: "netflix.com",
  spotify: "spotify.com",
  walmart: "walmart.com",
  target: "target.com",
  costco: "costco.com",
  doordash: "doordash.com",
  grubhub: "grubhub.com",
  instacart: "instacart.com",
  mcdonald: "mcdonalds.com",
  chipotle: "chipotle.com",
  dunkin: "dunkindonuts.com",
  paypal: "paypal.com",
  venmo: "venmo.com",
  chase: "chase.com",
  wells: "wellsfargo.com",
  bankofamerica: "bankofamerica.com",
  google: "google.com",
  airbnb: "airbnb.com",
  expedia: "expedia.com",
  southwest: "southwest.com",
  delta: "delta.com",
  united: "united.com",
  americanexpress: "americanexpress.com",
  amex: "americanexpress.com",
  capitalone: "capitalone.com",
  discover: "discover.com",
  kroger: "kroger.com",
  wholefoods: "wholefoodsmarket.com",
  trader: "traderjoes.com",
  publix: "publix.com",
  bestbuy: "bestbuy.com",
  homedepot: "homedepot.com",
  lowes: "lowes.com",
  shell: "shell.com",
  chevron: "chevron.com",
  exxon: "exxonmobil.com",
  bp: "bp.com",
};

/**
 * Returns domain for favicon if merchant is in allowlist, else null.
 */
export function getMerchantLogoDomain(merchantName: string): string | null {
  const normalized = merchantName.toLowerCase().replace(/\s+/g, "");
  for (const [key, domain] of Object.entries(MERCHANT_DOMAINS)) {
    if (normalized.includes(key)) return domain;
  }
  return null;
}
