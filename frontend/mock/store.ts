// The review mode's in-memory database: one base dataset, built fresh by
// `createStore`. The control (control.ts) holds the live one.

import type { AiStatus, BudgetAiSettings, BudgetAiUsage } from "../src/api/budget.ts";
import type { ApiKeyProvider, LotSuggestion, SyncHealth } from "../src/api/types.ts";
import { baseData, type BaseData } from "./data/base.ts";

export type Store = BaseData & {
  aiSettings: BudgetAiSettings;
  aiUsage: BudgetAiUsage;
  aiStatus: AiStatus;
  /** Settings → Server → API keys. Secrets are kept here only to answer
   *  `set`; like the server, the routes never send them back. */
  apiKeys: ApiKeyProvider[];
  /** Rows the "record purchases" window pre-fills, per holding (none in the base data). */
  lotSuggestions: Record<string, LotSuggestion[]>;
  /** Ledger buys the user deleted from the "record purchases" window. */
  deletedLots: string[];
  /** Ledger lots a provider sent: listed locked, kept by the preview. */
  providerLots: string[];
  /** An account's own bank-update health, when it differs from its connection's. */
  accountHealth: Record<string, SyncHealth>;
  /** Saving an account fails (the Edit account window's error). */
  accountSaveFails: boolean;
  /** Signing in asks for the second step (a code, or a backup code). */
  loginMfa: boolean;
  /** Every read but the signed-in user's fails: each card shows its error. */
  readsFail: boolean;
  /** Every write fails (signing in and out aside): each action's error. */
  writesFail: boolean;
  /** The accounts come back malformed, so the pages that show them break. */
  accountsBroken: boolean;
};

export function createStore(): Store {
  const data = baseData();
  data.user.prefs.budgetAiEnabled = true;
  return {
    ...data,
    lotSuggestions: {},
    deletedLots: [],
    providerLots: [],
    accountHealth: {},
    accountSaveFails: false,
    loginMfa: false,
    readsFail: false,
    writesFail: false,
    accountsBroken: false,
    apiKeys: [
      {
        key: "powens",
        displayName: "Powens",
        fields: [
          { key: "client_id", label: "Client ID", secret: false, value: "48211093" },
          { key: "domain", label: "Domain", secret: false, value: "myapp-sandbox.biapi.pro" },
          { key: "client_secret", label: "Client secret", secret: true, set: true },
          { key: "webhook_secret", label: "Webhook secret", secret: true, set: false },
        ],
      },
      { key: "jev", displayName: "JEV", fields: [{ key: "api_key", label: "API key", secret: true, set: true }] },
      { key: "brandfetch", displayName: "Brandfetch", fields: [{ key: "client_id", label: "Client ID", secret: false, value: null }] },
    ],
    aiSettings: { provider: "jev", model: "jev-small", available: ["jev"], defaults: { jev: "jev-small" } },
    aiUsage: {
      // As the server: AI prices and costs are in US dollars.
      currency: "USD",
      models: [{ model: "jev-small", runs: 14, runsWithoutUsage: 0, tokensIn: 412_300, tokensOut: 38_150, priceIn: "0.10", priceOut: "0.40", cost: "0.06" }],
      totalCost: "0.06",
    },
    aiStatus: {
      configured: true,
      running: false,
      remaining: 0,
      reviewCount: 0, // counted on read, from the rows
      lastRun: { outcome: "ok", error: null, startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
    },
  };
}
