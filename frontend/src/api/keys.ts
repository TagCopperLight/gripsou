import type { TransactionFilterQuery } from "./filter";
import type { Period } from "../lib/period";

// The one definition of every react-query key. Parameters are optional: omitting one yields the family
// prefix that invalidations use (`keys.netWorth()` matches every cached range).
export const keys = {
  health: () => ["health"] as const,
  setupStatus: () => ["setup-status"] as const,

  netWorth: (range?: string) =>
    (range === undefined ? ["net-worth"] : ["net-worth", range]) as readonly unknown[],
  accounts: () => ["accounts"] as const,
  accountSeries: (range?: string) =>
    (range === undefined
      ? ["account-series"]
      : ["account-series", range]) as readonly unknown[],
  accountTypes: () => ["account-types"] as const,

  holdings: () => ["holdings"] as const,
  // `range` needs an `id`; the id-only form is the prefix for one holding's price history.
  holdingPrices: (id?: string, range?: string) =>
    (id === undefined ? ["holding-prices"] : range === undefined
      ? ["holding-prices", id]
      : ["holding-prices", id, range]) as readonly unknown[],
  holdingLots: (id?: string) =>
    (id === undefined ? ["holding-lots"] : ["holding-lots", id]) as readonly unknown[],
  // Under the `holding-lots` prefix so `afterLotsSaved` refetches these too.
  holdingLotSuggestions: (id: string) => ["holding-lots", id, "suggestions"] as const,
  investmentReturns: () => ["investment-returns"] as const,

  transactions: (q?: TransactionFilterQuery) =>
    (q === undefined ? ["transactions"] : ["transactions", q]) as readonly unknown[],
  transactionCounts: (q?: TransactionFilterQuery) =>
    (q === undefined ? ["transaction-counts"] : ["transaction-counts", q]) as readonly unknown[],

  budgetCategories: () => ["budget-categories"] as const,
  budgetTags: () => ["budget-tags"] as const,
  budgetSummary: (period?: Period) =>
    (period === undefined ? ["budget-summary"] : ["budget-summary", period]) as readonly unknown[],
  budgetLatestMonth: () => ["budget-latest-month"] as const,
  budgetTrend: (anchor?: string) =>
    (anchor === undefined ? ["budget-trend"] : ["budget-trend", anchor]) as readonly unknown[],
  budgetAiStatus: () => ["budget-ai-status"] as const,
  budgetAiSettings: () => ["budget-ai-settings"] as const,
  budgetAiUsage: () => ["budget-ai-usage"] as const,
  budgetAiModels: (provider: string) => ["budget-ai-models", provider] as const,

  users: () => ["users"] as const,
  sessions: () => ["sessions"] as const,
  mfaStatus: () => ["mfaStatus"] as const,
  connections: () => ["connections"] as const,
  providers: () => ["providers"] as const,
  apiKeys: () => ["api-keys"] as const,
  providersEnabled: () => ["providers-enabled"] as const,
};
