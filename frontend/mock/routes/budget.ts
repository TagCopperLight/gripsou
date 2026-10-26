import type { Router } from "../router";
import type { Store } from "../store";
import * as v from "../views/budget";

export function budgetRoutes(r: Router<Store>): void {
  r.route("GET", "/transactions", ({ store, query }) => v.transactions(store, query));
  r.route("GET", "/transactions/counts", ({ store, query }) => v.counts(store, query));
  r.route("GET", "/budget/categories", ({ store }) => v.categories(store));
  r.route("GET", "/budget/tags", ({ store }) => v.tags(store));
  r.route("GET", "/budget/summary", ({ store, query }) => v.summary(store, query));
  r.route("GET", "/budget/trend", ({ store, query }) => v.trend(store, query));
  r.route("GET", "/budget/categorize/status", ({ store }) => ({
    ...store.aiStatus,
    reviewCount: store.txns.filter((x) => x.needsReview).length,
  }));
}
