import type { CategoryBody, TagBody } from "../../src/api/budget";
import { reply, type Router } from "../router";
import type { Store } from "../store";
import * as v from "../views/budget";

const taken = (rows: { name: string }[], name: string) =>
  rows.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());

export function budgetRoutes(r: Router<Store>): void {
  r.route("GET", "/transactions", ({ store, query }) => v.transactions(store, query));
  r.route("GET", "/transactions/counts", ({ store, query }) => v.counts(store, query));
  r.route("GET", "/budget/categories", ({ store }) => v.categories(store));
  r.route("GET", "/budget/tags", ({ store }) => v.tags(store));
  // A name already used (any case) is refused, as the server does.
  r.route("POST", "/budget/categories", ({ store, body }) => {
    const b = body as CategoryBody;
    if (taken(store.categories, b.name)) return reply(409, { error: "duplicate name" });
    const row = { ...b, id: crypto.randomUUID(), defaultKey: null, systemKey: null, sortOrder: store.categories.length };
    store.categories.push(row);
    return { ...row, txCount: 0 };
  });
  r.route("POST", "/budget/tags", ({ store, body }) => {
    const b = body as TagBody;
    if (taken(store.tags, b.name)) return reply(409, { error: "duplicate name" });
    const row = { ...b, id: crypto.randomUUID() };
    store.tags.push(row);
    return { ...row, txCount: 0 };
  });
  r.route("PATCH", "/budget/tags/:id", ({ store, params, body }) => {
    const b = body as Partial<TagBody>;
    const tag = store.tags.find((t) => t.id === params.id);
    if (!tag) return reply(404, { error: "no such tag" });
    if (b.name !== undefined && taken(store.tags.filter((t) => t !== tag), b.name)) return reply(409, { error: "duplicate name" });
    Object.assign(tag, b);
    return { ...tag, txCount: 0 };
  });
  r.route("GET", "/budget/summary", ({ store, query }) => v.summary(store, query));
  r.route("GET", "/budget/trend", ({ store, query }) => v.trend(store, query));
  r.route("GET", "/budget/categorize/status", ({ store }) => ({
    ...store.aiStatus,
    reviewCount: store.txns.filter((x) => x.needsReview).length,
  }));
}
