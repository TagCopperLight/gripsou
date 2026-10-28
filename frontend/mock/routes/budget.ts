import type { BulkBody, CategoryBody, SameDescriptionScope, TagBody } from "../../src/api/budget";
import type { TxnRow } from "../data/base";
import { reply, type Router } from "../router";
import type { Store } from "../store";
import * as v from "../views/budget";

const taken = (rows: { name: string }[], name: string) =>
  rows.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());

/** Rows sharing `row`'s description, not already in `categoryId`: what an
 *  "apply to the others" would reach. */
function sameDescription(store: Store, row: TxnRow, categoryId: string | null, scope: SameDescriptionScope = "all"): TxnRow[] {
  return store.txns.filter(
    (x) => x !== row && x.source === "cash" && x.description === row.description && x.categoryId !== categoryId && (scope === "all" || x.needsReview),
  );
}

/** A user's category write, as the server makes it: final, out of review. */
function file(row: TxnRow, categoryId: string | null) {
  Object.assign(row, { categoryId, categorySource: categoryId ? "user" : null, categoryConfidence: null, needsReview: false });
}

/** Filing a paired transfer outside a neutral category breaks its pair, so the
 *  server asks first: how many pairs it would break, nothing written. */
function pairBreaks(store: Store, rows: TxnRow[], categoryId: string | null | undefined, confirmed?: boolean): number {
  if (categoryId === undefined || confirmed) return 0;
  const neutral = store.categories.find((c) => c.id === categoryId)?.kind === "neutral";
  return neutral ? 0 : rows.filter((x) => x.isTransfer).length;
}

export function budgetRoutes(r: Router<Store>): void {
  r.route("GET", "/transactions", ({ store, query }) => v.transactions(store, query));
  r.route("GET", "/transactions/counts", ({ store, query }) => v.counts(store, query));
  r.route("PATCH", "/transactions/:id", ({ store, params, body }) => {
    const b = body as { categoryId?: string | null; tagIds?: string[]; checked?: boolean; confirmBreakPairs?: boolean; offerScope?: SameDescriptionScope };
    const row = store.txns.find((x) => x.id === params.id);
    if (!row) return reply(404, { error: "no such transaction" });
    const breaks = pairBreaks(store, [row], b.categoryId, b.confirmBreakPairs);
    if (breaks) return { sameDescriptionCount: 0, pendingPairBreaks: breaks };
    if (b.categoryId !== undefined) {
      file(row, b.categoryId);
      if (store.categories.find((c) => c.id === b.categoryId)?.kind !== "neutral") row.isTransfer = false;
    }
    if (b.tagIds) row.tagIds = b.tagIds;
    if (b.checked !== undefined) row.checked = b.checked;
    return { sameDescriptionCount: b.categoryId === undefined ? 0 : sameDescription(store, row, row.categoryId, b.offerScope).length };
  });
  r.route("POST", "/transactions/:id/apply-to-description", ({ store, params, body }) => {
    const b = body as { categoryId: string | null; scope?: SameDescriptionScope; confirmBreakPairs?: boolean };
    const row = store.txns.find((x) => x.id === params.id);
    if (!row) return reply(404, { error: "no such transaction" });
    const rows = sameDescription(store, row, b.categoryId, b.scope);
    const breaks = pairBreaks(store, rows, b.categoryId, b.confirmBreakPairs);
    if (breaks) return { updated: 0, pendingPairBreaks: breaks };
    rows.forEach((x) => file(x, b.categoryId));
    return { updated: rows.length, ids: rows.map((x) => x.id) };
  });
  r.route("POST", "/transactions/bulk", ({ store, body }) => {
    const b = body as Omit<BulkBody, "filter"> & { filter?: Record<string, string | boolean> };
    const rows = b.ids
      ? store.txns.filter((x) => b.ids!.includes(x.id))
      : v.matching(store, new URLSearchParams(Object.entries(b.filter ?? {}).map(([k, val]): [string, string] => [k, String(val)])));
    const breaks = pairBreaks(store, rows, b.categoryId, b.confirmBreakPairs);
    if (breaks) return { updated: 0, pendingPairBreaks: breaks };
    for (const x of rows) {
      if (b.categoryId !== undefined) file(x, b.categoryId);
      if (b.addTagIds) x.tagIds = [...new Set([...x.tagIds, ...b.addTagIds])];
      if (b.checked !== undefined) x.checked = b.checked;
    }
    return { updated: rows.length };
  });
  r.route("POST", "/budget/review/:id/accept", ({ store, params }) => {
    const row = store.txns.find((x) => x.id === params.id);
    if (!row) return reply(404, { error: "no such transaction" });
    Object.assign(row, { needsReview: false, categorySource: "user" });
    return { sameDescriptionCount: sameDescription(store, row, row.categoryId, "review").length };
  });
  r.route("POST", "/budget/review/:id/undo", ({ store, params, body }) => {
    const b = body as { categoryId: string | null; confidence: string | null };
    const row = store.txns.find((x) => x.id === params.id);
    if (!row) return reply(404, { error: "no such transaction" });
    Object.assign(row, { categoryId: b.categoryId, categorySource: b.categoryId ? "ai" : null, categoryConfidence: b.confidence, needsReview: true });
    return reply(204);
  });
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
  r.route("PATCH", "/budget/categories/:id", ({ store, params, body }) => {
    const b = body as Partial<CategoryBody>;
    const cat = store.categories.find((c) => c.id === params.id);
    if (!cat) return reply(404, { error: "no such category" });
    if (b.name !== undefined && taken(store.categories.filter((c) => c !== cat), b.name)) return reply(409, { error: "duplicate name" });
    Object.assign(cat, b);
    return v.categories(store).find((c) => c.id === cat.id);
  });
  r.route("PUT", "/budget/categories/order", ({ store, body }) => {
    (body as { ids: string[] }).ids.forEach((id, i) => {
      const cat = store.categories.find((c) => c.id === id);
      if (cat) cat.sortOrder = i;
    });
    return reply(204);
  });
  // Its rows go back to uncategorised, as on the server.
  r.route("DELETE", "/budget/categories/:id", ({ store, params }) => {
    store.categories = store.categories.filter((c) => c.id !== params.id);
    for (const x of store.txns) if (x.categoryId === params.id) Object.assign(x, { categoryId: null, categorySource: null, categoryConfidence: null });
    return reply(204);
  });
  r.route("DELETE", "/budget/tags/:id", ({ store, params }) => {
    store.tags = store.tags.filter((t) => t.id !== params.id);
    for (const x of store.txns) x.tagIds = x.tagIds.filter((t) => t !== params.id);
    return reply(204);
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
