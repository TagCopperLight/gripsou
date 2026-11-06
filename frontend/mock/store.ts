// The review mode's in-memory database: one base dataset, built fresh by
// `createStore`. The control (control.ts) holds the live one.

import type { AiStatus, BudgetAiSettings, BudgetAiUsage } from "../src/api/budget.ts";
import type { ApiKeyField, ApiKeyProvider, LotSuggestion, SyncHealth } from "../src/api/types.ts";
import { baseData, type BaseData } from "./data/base.ts";
import { CONFIG_PROVIDERS } from "./data/backend.ts";
import type { Fault } from "./faults.ts";

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
  /** Signing in asks for the second step (a code, or a backup code). */
  loginMfa: boolean;
  /** Requests the active states make fail. */
  faults: Fault[];
};

/** Saved values: a public field's text, whether a secret is set; absent is unset. */
const SAVED_KEYS: Record<string, Record<string, string | boolean>> = {
  powens: { client_id: "48211093", domain: "myapp-sandbox.biapi.pro", client_secret: true },
  jev: { api_key: true },
};

function apiKeys(): ApiKeyProvider[] {
  return CONFIG_PROVIDERS.map((p) => ({
    ...p,
    fields: p.fields.map(({ key, label, secret }): ApiKeyField => {
      const saved = SAVED_KEYS[p.key]?.[key];
      return secret ? { key, label, secret, set: saved === true } : { key, label, secret, value: typeof saved === "string" ? saved : null };
    }),
  }));
}

export function createStore(): Store {
  const data = baseData();
  data.user.prefs.budgetAiEnabled = true;
  return {
    ...data,
    lotSuggestions: {},
    deletedLots: [],
    providerLots: [],
    accountHealth: {},
    loginMfa: false,
    faults: [],
    apiKeys: apiKeys(),
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
