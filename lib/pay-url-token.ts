/** Extract pay link token from a public `/pay/{token}` URL. */
export function tokenFromPayUrl(payUrl: string | null | undefined): string | null {
  if (!payUrl) return null;
  try {
    const pathname = new URL(payUrl).pathname;
    const match = pathname.match(/\/pay\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    const match = payUrl.match(/\/pay\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}
