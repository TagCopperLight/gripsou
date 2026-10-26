import type { Router } from "../router";
import type { Store } from "../store";
import * as v from "../views/portfolio";

export function portfolioRoutes(r: Router<Store>): void {
  r.route("GET", "/dashboard/net-worth", ({ store, query }) => v.netWorth(store, query.get("range") ?? "6mo"));
  r.route("GET", "/accounts", ({ store }) => v.accounts(store));
  r.route("GET", "/accounts/series", ({ store, query }) => v.accountSeries(store, query.get("range") ?? "6mo"));
  r.route("GET", "/account-types", () => ["checking", "savings", "pea", "brokerage", "life_insurance", "retirement", "multiple"]);
  r.route("GET", "/connections", ({ store }) => v.connections(store));
  r.route("GET", "/holdings", ({ store }) => v.holdings(store));
  r.route("GET", "/investments/returns", ({ store }) => v.returns(store));
  r.route("GET", "/holdings/:id/prices", ({ store, params, query }) => v.prices(store, params.id, query.get("range") ?? "1y"));
  r.route("GET", "/holdings/:id/lots", ({ store, params }) => v.lotsOf(store, params.id));
  r.route("GET", "/holdings/:id/lots/suggestions", () => []);
}
