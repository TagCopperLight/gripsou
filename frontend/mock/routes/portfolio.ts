import { reply, type Router } from "../router";
import type { SaveLotAdd, SaveLotsInput } from "../../src/api/hooks";
import type { Store } from "../store";
import * as v from "../views/portfolio";

export function portfolioRoutes(r: Router<Store>): void {
  r.route("GET", "/dashboard/net-worth", ({ store, query }) => v.netWorth(store, query.get("range") ?? "6mo"));
  r.route("GET", "/accounts", ({ store }) => v.accounts(store));
  r.route("GET", "/accounts/series", ({ store, query }) => v.accountSeries(store, query.get("range") ?? "6mo"));
  r.route("GET", "/account-types", () => ["checking", "savings", "pea", "brokerage", "life_insurance", "retirement", "multiple"]);
  r.route("GET", "/connections", ({ store }) => v.connections(store));
  r.route("POST", "/sync", ({ store }) => {
    for (const c of store.connections) if (c.status !== "pending") v.syncConnection(store, c.id);
    return reply(202);
  });
  r.route("POST", "/connections/:id/sync", ({ store, params }) => {
    v.syncConnection(store, params.id);
    return reply(202);
  });
  // Powens' management page doesn't exist here: the tab opens on a blank page.
  r.route("POST", "/connections/:id/manage", () => ({ redirectUrl: "about:blank" }));
  r.route("GET", "/holdings", ({ store }) => v.holdings(store));
  r.route("GET", "/investments/returns", ({ store }) => v.returns(store));
  r.route("GET", "/holdings/:id/prices", ({ store, params, query }) => v.prices(store, params.id, query.get("range") ?? "1y"));
  r.route("GET", "/holdings/:id/lots", ({ store, params }) => v.lotsOf(store, params.id));
  r.route("GET", "/holdings/:id/lots/suggestions", ({ store, params }) => store.lotSuggestions[params.id] ?? []);
  r.route("POST", "/holdings/:id/lots/preview", ({ store, params, body }) =>
    v.previewLots(store, params.id, (body as { rows: SaveLotAdd[] }).rows));
  r.route("PUT", "/holdings/:id/lots", ({ store, params, body }) => {
    v.saveLots(store, params.id, body as SaveLotsInput);
    return reply(204);
  });
}
