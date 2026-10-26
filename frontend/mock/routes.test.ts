import { describe, expect, it } from "vitest";
import { CW8 } from "./data/base";
import { router } from "./routes";
import { resetStore } from "./store";

// One concrete request per GET the app makes (`grep getJson src`).
const GETS = [
  "/auth/me",
  "/auth/sessions",
  "/auth/mfa/status",
  "/auth/token/abc",
  "/dashboard/net-worth?range=6mo",
  "/accounts",
  "/accounts/series?range=1y",
  "/account-types",
  "/connections",
  "/holdings",
  "/investments/returns",
  `/holdings/${CW8}/prices?range=1y`,
  `/holdings/${CW8}/lots`,
  `/holdings/${CW8}/lots/suggestions`,
  "/transactions?limit=200&offset=0",
  "/transactions?limit=1",
  "/transactions/counts",
  "/budget/categories",
  "/budget/tags",
  "/budget/summary?month=2026-09",
  "/budget/summary?from=2026-01-01&to=2026-09-30",
  "/budget/trend?anchor=2026-09&months=12",
  "/budget/categorize/status",
  "/health",
  "/users",
  "/providers",
  "/providers/enabled",
  "/settings/budget-ai",
  "/settings/budget-ai/usage",
  "/settings/budget-ai/models/jev",
];

describe("base dataset", () => {
  it.each(GETS)("answers GET %s", (url) => {
    const u = new URL(url, "http://mock");
    const out = router.dispatch(resetStore(), "GET", u.pathname, u.searchParams, undefined);
    expect(out.status).toBe(200);
  });

  it("values the PEA from its lots and cash", () => {
    const store = resetStore();
    const accounts = router.dispatch(store, "GET", "/accounts", new URLSearchParams(), undefined).body as { id: string; value: string }[];
    const holdings = router.dispatch(store, "GET", "/holdings", new URLSearchParams(), undefined).body as { accountId: string; value: string }[];
    for (const a of accounts) {
      const sum = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + Number(h.value), 0);
      expect(Number(a.value)).toBeCloseTo(sum, 1);
    }
  });

  it("pages the transaction list", () => {
    const store = resetStore();
    const page = (offset: number) =>
      router.dispatch(store, "GET", "/transactions", new URLSearchParams({ limit: "200", offset: String(offset) }), undefined).body as unknown[];
    expect(page(0)).toHaveLength(200);
    expect(page(200).length).toBeGreaterThan(0);
  });
});
