import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";
import { getPlaidConfig } from "./plaid";

let plaidClient: PlaidApi | null = null;

// Suppress noisy Node deprecation spam from transitive deps on serverless runtimes.
// We only filter DEP0169 (`url.parse`) and keep all other warnings.
declare global {
  // eslint-disable-next-line no-var
  var __coconutDep0169Patched: boolean | undefined;
}

function patchDep0169Warning() {
  if (globalThis.__coconutDep0169Patched) return;
  globalThis.__coconutDep0169Patched = true;

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const maybeOptions =
      args.length > 0 && typeof args[args.length - 1] === "object"
        ? (args[args.length - 1] as { code?: string })
        : undefined;
    const codeFromArgs = maybeOptions?.code;
    const codeFromError =
      typeof warning === "object" && warning && "code" in warning
        ? String((warning as { code?: string }).code ?? "")
        : "";
    const message =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : String(warning);

    if (
      codeFromArgs === "DEP0169" ||
      codeFromError === "DEP0169" ||
      message.includes("`url.parse()` behavior is not standardized")
    ) {
      return;
    }
    return originalEmitWarning(warning as never, ...(args as never[]));
  }) as typeof process.emitWarning;
}

patchDep0169Warning();

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

