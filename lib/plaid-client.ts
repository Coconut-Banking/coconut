import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";
import { getPlaidConfig } from "./plaid";

let plaidClient: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi | null {
  const { clientId, secret, env, isConfigured } = getPlaidConfig();
  if (!isConfigured || !clientId || !secret) return null;

  if (!plaidClient) {
    const basePath =
      env === "production"
        ? PlaidEnvironments.production
        : PlaidEnvironments.sandbox;

    const configuration = new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    });
    plaidClient = new PlaidApi(configuration);
  }
  return plaidClient;
}

