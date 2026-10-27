// The review mode's in-memory database: one base dataset, built fresh by
// `createStore`. The control (control.ts) holds the live one.

import type { AiStatus, BudgetAiSettings, BudgetAiUsage } from "../src/api/budget";
import type { LotSuggestion, SyncHealth } from "../src/api/types";
import { baseData, type BaseData } from "./data/base";

export type Store = BaseData & {
  aiSettings: BudgetAiSettings;
  aiUsage: BudgetAiUsage;
  aiStatus: AiStatus;
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
    readsFail: false,
    writesFail: false,
    accountsBroken: false,
    aiSettings: { provider: "jev", model: "jev-small", available: ["jev"], defaults: { jev: "jev-small" } },
    aiUsage: {
      currency: "EUR",
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
