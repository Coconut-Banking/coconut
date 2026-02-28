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

import path from "path";
import fs from "fs";

// Persist token to file so it survives Fast Refresh & server restarts in dev.
// In production, store access_token in your DB per user.
const TOKEN_FILE = path.join(process.cwd(), ".plaid-token.json");

function readTokenFile(): { accessToken: string | null; itemId: string | null } {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw) as { access_token?: string; item_id?: string };
    return {
      accessToken: data.access_token ?? null,
      itemId: data.item_id ?? null,
    };
  } catch {
    return { accessToken: null, itemId: null };
  }
}

function writeTokenFile(accessToken: string, itemId: string) {
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ access_token: accessToken, item_id: itemId }, null, 0),
      "utf-8"
    );
  } catch (err) {
    console.warn("[plaid] Could not persist token to file:", err);
  }
}

export function setPlaidAccessToken(accessToken: string, itemId: string) {
  writeTokenFile(accessToken, itemId);
}

export function getPlaidAccessToken(): string | null {
  const { accessToken } = readTokenFile();
  return accessToken;
}

export function clearPlaidAccessToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch {
    // ignore
  }
}

export function isPlaidLinked(): boolean {
  return Boolean(getPlaidAccessToken());
}
