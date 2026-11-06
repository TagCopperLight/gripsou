import { fail, reply, type Failure, type Router } from "../router.ts";
import { RANGES, type Range } from "../../src/api/wire.ts";
import type { Store } from "../store.ts";
import * as v from "../views/portfolio.ts";
import { connectionRow } from "../data/rows.ts";
import en from "../../src/i18n/en.json" with { type: "json" };

/** A chart's `range` parameter, as the server's `RangeParams` reads it. */
function rangeParam(query: URLSearchParams): Range | Failure {
  const range = query.get("range");
  if (range === null) return "6mo";
  return RANGES.find((r) => r === range)
    ?? fail(400, `Failed to deserialize query string: range: unknown variant \`${range}\`, expected one of ${RANGES.map((r) => `\`${r}\``).join(", ")}`);
}

export function portfolioRoutes(r: Router<Store>): void {
  r.route("GET /dashboard/net-worth", ({ store, query }) => {
    const range = rangeParam(query);
    return typeof range === "string" ? v.netWorth(store, range) : range;
  });
  r.route("GET /accounts", ({ store }) => v.accounts(store));
  r.route("GET /accounts/series", ({ store, query }) => {
    const range = rangeParam(query);
    return typeof range === "string" ? v.accountSeries(store, range) : range;
  });
  r.route("PATCH /accounts/:id", ({ store, params, body: { name, typeKey, color } }) => {
    const account = store.accounts.find((a) => a.id === params.id);
    if (!account) return fail(404, "account not found");
    Object.assign(account, { name, typeKey, color });
    return { id: account.id, name, color, typeKey };
  });
  // The labelled types: a backend test pins them to the seeded `account_type` rows.
  r.route("GET /account-types", () => Object.keys(en.accountTypes));
  r.route("GET /connections", ({ store }) => v.connections(store));
  r.route("POST /sync", ({ store }) => {
    const ready = store.connections.filter((c) => c.status !== "pending" && c.status !== "syncing");
    for (const c of ready) v.syncConnection(store, c.id);
    return reply(202, { started: ready.length });
  });
  r.route("POST /connections/:id/sync", ({ store, params }) => {
    const c = store.connections.find((x) => x.id === params.id);
    if (!c) return fail(404, "connection not found");
    if (c.status === "syncing") return fail(409, "connection is already syncing");
    v.syncConnection(store, c.id);
    return reply(202, { id: c.id, status: c.status, lastSyncAt: c.lastSyncAt, lastError: c.lastError });
  });
  // No provider page here: the new bank shows up at once, syncs for a few
  // seconds, then is healthy with no account.
  r.route("POST /connections/init", ({ store, body: { providerKey } }) => {
    const connectionId = store.ids.next("connection");
    store.connections.push(connectionRow(connectionId, "Banque Populaire", {
      providerKey, status: "syncing", lastSyncAt: null, health: null,
    }));
    v.syncConnection(store, connectionId);
    return reply(201, { connectionId, redirectUrl: null });
  });
  // Back from the bank's page: an `error` from the provider fails it.
  r.route("POST /connections/complete", ({ body }) =>
    body.params.error ? fail(400, "provider error") : reply(204),
  );
  r.route("DELETE /connections/:id", ({ store, params }) => {
    const gone = new Set(store.accounts.filter((a) => a.connectionId === params.id).map((a) => a.id));
    store.connections = store.connections.filter((c) => c.id !== params.id);
    store.accounts = store.accounts.filter((a) => !gone.has(a.id));
    store.securities = store.securities.filter((s) => !gone.has(s.accountId));
    store.txns = store.txns.filter((x) => !gone.has(x.accountId));
    return reply(204);
  });
  // Powens' management page doesn't exist here: the tab opens on a blank page.
  r.route("POST /connections/:id/manage", () => ({ redirectUrl: "about:blank" }));
  r.route("GET /holdings", ({ store }) => v.holdings(store));
  r.route("GET /investments/returns", ({ store }) => v.returns(store));
  r.route("GET /holdings/:id/prices", ({ store, params, query }) => {
    const range = rangeParam(query);
    return typeof range === "string" ? v.prices(store, params.id, range) : range;
  });
  r.route("GET /holdings/:id/lots", ({ store, params }) => v.lotsOf(store, params.id));
  r.route("GET /holdings/:id/lots/suggestions", ({ store, params }) => store.lotSuggestions[params.id] ?? []);
  r.route("POST /holdings/:id/lots/preview", ({ store, params, body }) =>
    v.previewLots(store, params.id, body.rows));
  r.route("PUT /holdings/:id/lots", ({ store, params, body }) => {
    v.saveLots(store, params.id, body);
    return reply(204);
  });
}
