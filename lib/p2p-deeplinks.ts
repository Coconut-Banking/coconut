/**
 * Deep link generators for P2P payment apps.
 * These open the native app on mobile or show instructions on web.
 */

/**
 * Generate a Venmo deep link for payment.
 * venmo://paycharge?txn=pay&recipients=USERNAME&amount=AMOUNT&note=NOTE
 */
export function getVenmoDeepLink(
  amount: number,
  recipient?: string,
  note?: string
): { url: string; webUrl: string } {
  const params = new URLSearchParams();
  params.set("txn", "pay");
  if (recipient) params.set("recipients", recipient);
  params.set("amount", amount.toFixed(2));
  if (note) params.set("note", note);

  return {
    url: `venmo://paycharge?${params.toString()}`,
    webUrl: `https://venmo.com/?${params.toString()}`,
  };
}

/**
 * Generate a Cash App deep link for payment.
 * https://cash.app/$CASHTAG/AMOUNT
 */
export function getCashAppDeepLink(
  amount: number,
  cashtag?: string,
  _note?: string
): { url: string; webUrl: string } {
  const base = cashtag
    ? `https://cash.app/${cashtag.startsWith("$") ? cashtag : `$${cashtag}`}`
    : "https://cash.app";

  const url = amount > 0 ? `${base}/${amount.toFixed(2)}` : base;

  return { url, webUrl: url };
}

/**
 * Generate a PayPal.me link for payment.
 * https://paypal.me/USERNAME/AMOUNT
 */
export function getPayPalMeLink(
  amount: number,
  username?: string
): { url: string; webUrl: string } {
  if (!username) {
    return { url: "https://paypal.me", webUrl: "https://paypal.me" };
  }

  const url = `https://paypal.me/${username}/${amount.toFixed(2)}`;
  return { url, webUrl: url };
}

/**
 * Get all available P2P deep links for a settlement.
 */
export function getP2PDeepLinks(
  amount: number,
  handles: {
    venmo_username?: string | null;
    cashapp_cashtag?: string | null;
    paypal_username?: string | null;
  },
  note?: string
): Array<{ platform: string; label: string; url: string; webUrl: string }> {
  const links: Array<{ platform: string; label: string; url: string; webUrl: string }> = [];

  if (handles.venmo_username) {
    const { url, webUrl } = getVenmoDeepLink(amount, handles.venmo_username, note);
    links.push({ platform: "venmo", label: "Pay with Venmo", url, webUrl });
  }

  if (handles.cashapp_cashtag) {
    const { url, webUrl } = getCashAppDeepLink(amount, handles.cashapp_cashtag, note);
    links.push({ platform: "cashapp", label: "Pay with Cash App", url, webUrl });
  }

  if (handles.paypal_username) {
    const { url, webUrl } = getPayPalMeLink(amount, handles.paypal_username);
    links.push({ platform: "paypal", label: "Pay with PayPal", url, webUrl });
  }

  return links;
}
