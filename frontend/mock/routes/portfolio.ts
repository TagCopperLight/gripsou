import { reply, type Router } from "../router";
import type { SaveLotAdd, SaveLotsInput } from "../../src/api/hooks";
import type { Store } from "../store";
import * as v from "../views/portfolio";
import { id } from "../data/util";

export function portfolioRoutes(r: Router<Store>): void {
  r.route("GET", "/dashboard/net-worth", ({ store, query }) => v.netWorth(store, query.get("range") ?? "6mo"));
  r.route("GET", "/accounts", ({ store }) => v.accounts(store));
  r.route("GET", "/accounts/series", ({ store, query }) => v.accountSeries(store, query.get("range") ?? "6mo"));
  r.route("PATCH", "/accounts/:id", ({ store, params, body }) => {
    const account = store.accounts.find((a) => a.id === params.id);
    if (!account) return reply(404);
    if (store.accountSaveFails) return reply(500, { error: "forced by the review panel" });
    const { name, typeKey, color } = body as { name: string; typeKey: string; color: string };
    Object.assign(account, { name, typeKey, color });
    return reply(204);
  });
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
  // No provider page here: the new bank shows up at once, syncs for a few
  // seconds, then is healthy with no account.
  r.route("POST", "/connections/init", ({ store, body }) => {
    const n = store.connections.length + 1;
    const connectionId = id("con", 900 + n);
    store.connections.push({
      providerKey: (body as { providerKey: string }).providerKey, id: connectionId, displayName: "Banque Populaire",
      status: "syncing", lastSyncAt: null, lastError: null, logo: null, canManage: true, health: null,
    });
    v.syncConnection(store, connectionId);
    return { connectionId, redirectUrl: null };
  });
  r.route("DELETE", "/connections/:id", ({ store, params }) => {
    const gone = new Set(store.accounts.filter((a) => a.connectionId === params.id).map((a) => a.id));
    store.connections = store.connections.filter((c) => c.id !== params.id);
    store.accounts = store.accounts.filter((a) => !gone.has(a.id));
    store.securities = store.securities.filter((s) => !gone.has(s.accountId));
    store.txns = store.txns.filter((x) => !gone.has(x.accountId));
    return reply(204);
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
