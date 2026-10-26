// The review mode's in-memory database: one base dataset, built fresh by
// `createStore`. The control (control.ts) holds the live one.

import type { AiStatus, BudgetAiSettings, BudgetAiUsage } from "../src/api/budget";
import { baseData, type BaseData } from "./data/base";

export type Store = BaseData & {
  aiSettings: BudgetAiSettings;
  aiUsage: BudgetAiUsage;
  aiStatus: AiStatus;
};

export function createStore(): Store {
  const data = baseData();
  data.user.prefs.budgetAiEnabled = true;
  return {
    ...data,
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
