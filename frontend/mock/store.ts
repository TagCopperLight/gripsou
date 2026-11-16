// The review mode's in-memory database, built fresh by `createStore`.

import type { AiStatus, ApiKeyField, ApiKeyProvider, BudgetAiSettings, BudgetAiUsage, LotSuggestion, SyncHealth } from "../src/api/wire.ts";
import { baseData, type BaseData } from "./data/base.ts";
import { CONFIG_PROVIDERS, keysReady } from "./data/backend.ts";
import type { Fault } from "./faults.ts";

export type Store = BaseData & {
  aiSettings: BudgetAiSettings;
  aiUsage: BudgetAiUsage;
  aiStatus: AiStatus;
  /** Secrets are kept only to answer `set`; the routes never send them back. */
  apiKeys: ApiKeyProvider[];
  lotSuggestions: Record<string, LotSuggestion[]>;
  deletedLots: string[];
  providerLots: string[];
  accountHealth: Record<string, SyncHealth>;
  loginMfa: boolean;
  setupNeeded: boolean;
  faults: Fault[];
};

/** Absent is unset; a secret is a boolean. Brandfetch has none, so it starts not ready. */
const SAVED_KEYS: Record<string, Record<string, string | boolean>> = {
  powens: { client_id: "48211093", domain: "myapp-sandbox.biapi.pro", client_secret: true },
  jev: { api_key: true },
};

function apiKeys(): ApiKeyProvider[] {
  return CONFIG_PROVIDERS.map((p) => {
    const provider: ApiKeyProvider = {
      ...p,
      ready: false,
      fields: p.fields.map(({ key, label, secret }): ApiKeyField => {
        const saved = SAVED_KEYS[p.key]?.[key];
        return secret ? { key, label, secret, set: saved === true } : { key, label, secret, value: typeof saved === "string" ? saved : null };
      }),
    };
    return { ...provider, ready: keysReady(provider) };
  });
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
    setupNeeded: false,
    faults: [],
    apiKeys: apiKeys(),
    aiSettings: { provider: "jev", model: "jev-small", available: ["jev"], defaults: { jev: "jev-small" } },
    aiUsage: {
      currency: "USD",
      models: [{ model: "jev-small", runs: 14, runsWithoutUsage: 0, tokensIn: 412_300, tokensOut: 38_150, priceIn: "0.10", priceOut: "0.40", cost: "0.06" }],
      totalCost: "0.06",
    },
    aiStatus: {
      configured: true,
      running: false,
      remaining: 0,
      reviewCount: 0,
      lastRun: { outcome: "ok", error: null, startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
    },
  };
}
