// The budget readers over the store: the transactions list and its counts,
// categories and tags with their row counts, and the Overview's figures. A
// simplified copy of the server's rules (core/src/budget/overview.rs), close
// enough to review the screens with.

import type { BreakdownRow, BudgetCategory, BudgetSummary, BudgetTag, BudgetTrend, CategoryRef, Figure, Slice, SliceAmount, Transaction, TransactionCounts, TransactionParams, TypeBucket } from "../../src/api/wire.ts";
import type { TransactionFilterQuery } from "../../src/api/filter.ts";
import {
  BASELINE_MONTHS,
  BREAKDOWN_KEEP,
  MIN_BASELINE_MONTHS,
  SANKEY_MAX_SLICES,
  SANKEY_MIN_SHARE,
  TREND_ANCHOR_KEEP,
  TREND_FOLD_KEY,
  TREND_KEEP,
} from "../data/backend.ts";
import type { CategoryRow, TxnRow } from "../data/rows.ts";
import { EUR_PER_USD, dayOf, isoDay, money } from "../data/util.ts";
import type { Store } from "../store.ts";
import { addMonths, monthBounds } from "../../src/lib/month.ts";

/** The AI's guess waiting for review (`categoryId` null: it abstained). */
export function queueForReview(row: TxnRow, categoryId: string | null, confidence: string | null): TxnRow {
  return Object.assign(row, { categoryId, categorySource: categoryId ? "ai" : null, categoryConfidence: confidence, needsReview: true });
}

export function categories(store: Store): BudgetCategory[] {
  return [...store.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      defaultKey: c.defaultKey,
      color: c.color,
      icon: c.icon,
      hint: c.hint,
      kind: c.kind,
      systemKey: c.systemKey,
      archived: c.archived,
      txCount: store.txns.filter((x) => x.categoryId === c.id).length,
    }));
}

export function tags(store: Store): BudgetTag[] {
  return store.tags.map((t) => ({ ...t, txCount: store.txns.filter((x) => x.tagIds.includes(t.id)).length }));
}

/** A row's value in euros; null for a foreign row when the budget has no rate
 *  (the "Budget: a transaction has no rate" state). */
function reporting(store: Store, x: TxnRow): number | null {
  const currency = store.accounts.find((a) => a.id === x.accountId)?.currency ?? "EUR";
  if (currency === "EUR") return x.amount;
  return store.fx.budget ? null : Math.round(x.amount * EUR_PER_USD * 100) / 100;
}

export function transactionView(store: Store, x: TxnRow): Transaction {
  const a = store.accounts.find((acc) => acc.id === x.accountId)!;
  const inEuros = reporting(store, x);
  const c = store.categories.find((cat) => cat.id === x.categoryId) ?? null;
  const sec = x.holdingId ? store.securities.find((s) => s.id === x.holdingId) : undefined;
  return {
    id: x.id,
    t: x.t,
    type: x.type,
    description: x.description,
    amount: money(x.amount),
    amountReporting: inEuros === null ? null : money(inEuros),
    currency: a.currency,
    accountId: a.id,
    accountName: a.name,
    accountColor: a.color,
    source: x.source,
    ticker: sec?.ticker ?? null,
    logo: null,
    quantity: x.quantity === null ? null : String(x.quantity),
    unitPrice: x.unitPrice === null ? null : money(x.unitPrice),
    fee: x.fee === null ? null : money(x.fee),
    categoryId: c?.id ?? null,
    categoryName: c?.name ?? null,
    categoryDefaultKey: c?.defaultKey ?? null,
    categoryColor: c?.color ?? null,
    categoryIcon: c?.icon ?? null,
    categoryKind: c?.kind ?? null,
    categorySource: x.categorySource,
    categoryConfidence: x.categoryConfidence,
    needsReview: x.needsReview,
    checked: x.checked,
    isTransfer: x.isTransfer,
    isOrphanTransfer: x.isOrphanTransfer,
    tags: store.tags.filter((t) => x.tagIds.includes(t.id)),
  };
}

const ids = (raw: string) => raw.split(",").filter(Boolean);
const flag = (raw: string) => raw === "true";

/** Reads each field `transactionFilterFields` writes: a new filter field
 *  fails to type-check here until the mock reads it. */
const FILTER_FIELDS: { [K in keyof TransactionFilterQuery]-?: (raw: string) => TransactionFilterQuery[K] } = {
  search: (raw) => raw,
  accountId: (raw) => raw,
  bucket: (raw) => raw as TypeBucket,
  from: (raw) => raw,
  to: (raw) => raw,
  categoryIds: ids,
  tagIds: ids,
  uncategorized: flag,
  needsReview: flag,
  includeTransfers: flag,
};

/** The filter of a query string or of a bulk body's `filter`. */
export function parseTransactionFilter(fields: URLSearchParams | TransactionParams): TransactionFilterQuery {
  const entries = fields instanceof URLSearchParams ? [...fields] : Object.entries(fields);
  const f: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (k in FILTER_FIELDS && v !== undefined) f[k] = FILTER_FIELDS[k as keyof TransactionFilterQuery](String(v));
  }
  return f as TransactionFilterQuery;
}

/** The rows a filter selects, newest first — the list, counts and bulk share it. */
export function matching(store: Store, f: TransactionFilterQuery): TxnRow[] {
  const search = f.search?.toLowerCase();
  const bucket = f.bucket ?? "all";
  const catIds = f.categoryIds ?? [];
  const tagIds = f.tagIds ?? [];
  return store.txns.filter((x) => {
    if (x.isTransfer && !f.includeTransfers) return false;
    if (search && !(x.description ?? "").toLowerCase().includes(search)) return false;
    if (f.accountId && x.accountId !== f.accountId) return false;
    if (bucket === "in" && !(x.source === "cash" && x.amount > 0)) return false;
    if (bucket === "out" && !(x.source === "cash" && x.amount < 0)) return false;
    if (bucket === "lots" && x.source !== "lot") return false;
    if (f.from && x.t < dayOf(f.from)) return false;
    if (f.to && x.t > dayOf(f.to)) return false;
    if (catIds.length && !catIds.includes(x.categoryId ?? "")) return false;
    if (tagIds.length && !tagIds.every((t) => x.tagIds.includes(t))) return false;
    if (f.uncategorized && !(x.source === "cash" && x.categoryId === null)) return false;
    if (f.needsReview && !x.needsReview) return false;
    return true;
  });
}

export function transactions(store: Store, q: URLSearchParams): Transaction[] {
  const limit = Number(q.get("limit") ?? 200);
  const offset = Number(q.get("offset") ?? 0);
  return matching(store, parseTransactionFilter(q))
    .slice(offset, offset + limit)
    .map((x) => transactionView(store, x));
}

export function counts(store: Store, q: URLSearchParams): TransactionCounts {
  const rows = matching(store, parseTransactionFilter(q));
  // What "select all shown" covers, as the server: the cash rows only.
  const cash = rows.filter((x) => x.source === "cash");
  const visible = store.txns.filter((x) => !x.isTransfer);
  return {
    matching: rows.length,
    total: visible.length,
    uncategorized: visible.filter((x) => x.source === "cash" && x.categoryId === null).length,
    selectable: cash.length,
    matchingTotal: money(cash.reduce((s, x) => s + (reporting(store, x) ?? 0), 0)),
    fxMissing: cash.some((x) => reporting(store, x) === null),
  };
}

// ── Overview ────────────────────────────────────────────────────────────────

type Month = string; // "YYYY-MM"

function monthOf(t: number): Month {
  return isoDay(t).slice(0, 7);
}

function ref(c: CategoryRow): CategoryRef {
  return { id: c.id, name: c.name, defaultKey: c.defaultKey, color: c.color, icon: c.icon };
}

/** Budget rows, in euros: cash only (a lot is not spending), no neutral
 *  category; a row with no rate counts for nothing (the server flags it). */
function budgetRows(store: Store): (TxnRow & { cat: CategoryRow | null })[] {
  return store.txns
    .filter((x) => x.source === "cash")
    .map((x) => ({ ...x, amount: reporting(store, x) ?? 0, cat: store.categories.find((c) => c.id === x.categoryId) ?? null }))
    .filter((x) => x.cat?.kind !== "neutral");
}

type Row = ReturnType<typeof budgetRows>[number];

const UNCAT = "uncategorised";

/** Expense-side magnitudes per slice key: category nets that went out, and
 *  uncategorised outflows. */
function expenseSide(rows: Row[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const x of rows) {
    if (x.cat?.kind === "expense") net.set(x.cat.id, (net.get(x.cat.id) ?? 0) - x.amount);
    else if (!x.cat && x.amount < 0) net.set(UNCAT, (net.get(UNCAT) ?? 0) - x.amount);
  }
  for (const [k, v] of net) if (v <= 0) net.delete(k);
  return net;
}

function incomeSide(rows: Row[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const x of rows) {
    if (x.cat?.kind === "income") net.set(x.cat.id, (net.get(x.cat.id) ?? 0) + x.amount);
    else if (!x.cat && x.amount > 0) net.set(UNCAT, (net.get(UNCAT) ?? 0) + x.amount);
  }
  for (const [k, v] of net) if (v <= 0) net.delete(k);
  return net;
}

function sum(m: Map<string, number>): number {
  return [...m.values()].reduce((a, b) => a + b, 0);
}

function slice(store: Store, key: string): Slice {
  if (key === UNCAT) return { kind: "uncategorised" };
  if (key === "other") return { kind: "other" };
  return { kind: "category", category: ref(store.categories.find((c) => c.id === key)!) };
}

function sorted(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Keeps the slices the Sankey shows of `total`; the rest becomes Other. */
function collapse(store: Store, entries: [string, number][], total: number): SliceAmount[] {
  const kept = entries.filter(([, v]) => v >= total * SANKEY_MIN_SHARE).slice(0, SANKEY_MAX_SLICES);
  const rest = entries.filter((e) => !kept.includes(e)).reduce((s, [, v]) => s + v, 0);
  const out = kept.map(([k, v]) => ({ slice: slice(store, k), amount: money(v) }));
  if (rest > 0) out.push({ slice: { kind: "other" }, amount: money(rest) });
  return out;
}

function inPeriod(rows: Row[], from: string, to: string): Row[] {
  return rows.filter((x) => x.t >= dayOf(from) && x.t <= dayOf(to));
}

function monthRows(rows: Row[], m: Month): Row[] {
  return rows.filter((x) => monthOf(x.t) === m);
}

export function summary(store: Store, q: URLSearchParams): BudgetSummary {
  const all = budgetRows(store);
  const month = q.get("month");
  const { from, to } = month ? monthBounds(month) : { from: q.get("from")!, to: q.get("to")! };
  const rows = inPeriod(all, from, to);
  const exp = expenseSide(rows);
  const inc = incomeSide(rows);
  const income = sum(inc);
  const expenses = sum(exp);

  // Comparisons only for a month with enough full months of history before it.
  const firstMonth = all.length ? monthOf(Math.min(...all.map((x) => x.t))) : null;
  const history = month && firstMonth
    ? Array.from({ length: BASELINE_MONTHS }, (_, i) => addMonths(month, i - BASELINE_MONTHS)).filter((m) => m >= firstMonth)
    : [];
  const compare = history.length >= MIN_BASELINE_MONTHS;
  const avgOf = (f: (r: Row[]) => number) => history.reduce((s, m) => s + f(monthRows(all, m)), 0) / Math.max(1, history.length);
  const figure = (amount: number, f: (r: Row[]) => number): Figure =>
    month && compare
      ? { amount: money(amount), prevMonth: money(f(monthRows(all, addMonths(month, -1)))), avg12: money(Math.round(avgOf(f))) }
      : { amount: money(amount) };
  const incomeOf = (r: Row[]) => sum(incomeSide(r));
  const expensesOf = (r: Row[]) => sum(expenseSide(r));

  // In cents, so a month that nets to zero reads exactly zero.
  const remainder = Math.round((income - expenses) * 100) / 100;
  const breakdownEntries = sorted(exp);
  const breakdown: BreakdownRow[] = breakdownEntries.slice(0, BREAKDOWN_KEEP).map(([k, v]) => {
    const row: BreakdownRow = {
      slice: slice(store, k),
      amount: money(v),
      txnCount: rows.filter((x) => (k === UNCAT ? !x.cat && x.amount < 0 : x.cat?.id === k)).length,
    };
    if (compare) row.avg12 = money(avgOf((r) => expenseSide(r).get(k) ?? 0));
    return row;
  });
  const rest = breakdownEntries.slice(BREAKDOWN_KEEP);
  if (rest.length) {
    breakdown.push({
      slice: { kind: "other" },
      amount: money(rest.reduce((s, [, v]) => s + v, 0)),
      txnCount: rows.filter((x) => rest.some(([k]) => (k === UNCAT ? !x.cat : x.cat?.id === k))).length,
    });
  }

  return {
    txnCount: rows.length,
    fxMissing: store.fx.budget,
    figures: {
      income: figure(income, incomeOf),
      expenses: figure(expenses, expensesOf),
      net: figure(remainder, (r) => incomeOf(r) - expensesOf(r)),
    },
    sankey: {
      sources: collapse(store, sorted(inc), expenses),
      destinations: collapse(store, sorted(exp), expenses),
      ...(remainder > 0 ? { notSpent: money(remainder) } : remainder < 0 ? { drawnFromSavings: money(-remainder) } : {}),
    },
    breakdown,
  };
}

export function trend(store: Store, q: URLSearchParams): BudgetTrend {
  const anchor = q.get("anchor")!;
  const n = Number(q.get("months") ?? 12);
  const months = Array.from({ length: n }, (_, i) => addMonths(anchor, i - n + 1));
  const all = budgetRows(store);
  const perMonth = months.map((m) => expenseSide(monthRows(all, m)));
  const totals = new Map<string, number>();
  for (const m of perMonth) for (const [k, v] of m) totals.set(k, (totals.get(k) ?? 0) + v);
  const fold = store.categories.find((c) => c.defaultKey === TREND_FOLD_KEY)?.id;
  const rank = sorted(totals).map(([k]) => k).filter((k) => k !== fold);
  const anchorTop = sorted(perMonth[n - 1] ?? new Map()).map(([k]) => k).filter((k) => k !== fold).slice(0, TREND_ANCHOR_KEEP);
  const kept: string[] = [];
  for (const k of [...anchorTop, ...rank]) {
    if (kept.length === TREND_KEEP) break;
    if (!kept.includes(k)) kept.push(k);
  }
  kept.sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  const series = kept.map((k) => ({ slice: slice(store, k), values: perMonth.map((m) => money(m.get(k) ?? 0)) }));
  const otherValues = perMonth.map((m) => [...m.entries()].filter(([k]) => !kept.includes(k)).reduce((s, [, v]) => s + v, 0));
  if (otherValues.some((v) => v > 0)) series.push({ slice: { kind: "other" }, values: otherValues.map((v) => money(v)) });
  return { months, series };
}
