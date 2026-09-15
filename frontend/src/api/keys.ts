import type { TransactionFilterQuery } from "./types";

// The one definition of every react-query key.
//
// Keys used to be bare string literals written at 20 read sites and re-typed at
// 22 invalidation sites, which is how AUDIT.md's C-17/C-18/Z-6 happened: the set
// of things a mutation must refresh was knowledge that lived only in a comment
// next to each mutation.
//
// Parameterised keys take their parameter as OPTIONAL, and omitting it yields
// the family prefix:
//
//     keys.netWorth("1y")  ->  ["net-worth", "1y"]   one cached range
//     keys.netWorth()      ->  ["net-worth"]         every cached range
//
// That works because react-query matches invalidations by key prefix, so the
// read sites pass the parameter and the invalidation sites don't. Do not
// hand-write a key anywhere else; add it here instead.
export const keys = {
  health: () => ["health"] as const,

  netWorth: (range?: string) =>
    (range === undefined ? ["net-worth"] : ["net-worth", range]) as readonly unknown[],
  distribution: () => ["distribution"] as const,
  accounts: () => ["accounts"] as const,
  accountSeries: (range?: string) =>
    (range === undefined
      ? ["account-series"]
      : ["account-series", range]) as readonly unknown[],
  accountTypes: () => ["account-types"] as const,

  holdings: () => ["holdings"] as const,
  // `range` is only meaningful with an `id`; the id-only form is the family
  // prefix for one holding's price history across every range.
  holdingPrices: (id: string, range?: string) =>
    (range === undefined
      ? ["holding-prices", id]
      : ["holding-prices", id, range]) as readonly unknown[],
  holdingLots: (id: string) => ["holding-lots", id] as const,

  transactions: (q?: TransactionFilterQuery) =>
    (q === undefined ? ["transactions"] : ["transactions", q]) as readonly unknown[],

  users: () => ["users"] as const,
  sessions: () => ["sessions"] as const,
  connections: () => ["connections"] as const,
  providers: () => ["providers"] as const,
  providersEnabled: () => ["providers-enabled"] as const,
  corsOrigins: () => ["cors-origins"] as const,
};
