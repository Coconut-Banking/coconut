/**
 * Plaid config from env. Use PLAID_ENV=sandbox for testing, production for live.
 * Client ID and the appropriate secret (sandbox or production) are resolved here.
 */
function getPlaidSecret(): string | undefined {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (env === "production") {
    return process.env.PLAID_PRODUCTION_SECRET;
  }
  return process.env.PLAID_SANDBOX_SECRET;
}

export function getPlaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = getPlaidSecret();
  const env = (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "development" | "production";

  return {
    clientId,
    secret,
    env,
    isConfigured: Boolean(clientId && secret),
  };
}
