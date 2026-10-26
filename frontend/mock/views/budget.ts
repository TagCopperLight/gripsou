// The budget readers over the store: the transactions list and its counts,
// categories and tags with their row counts, and the Overview's figures. A
// simplified copy of the server's rules (core/src/budget/overview.rs), close
// enough to review the screens with.

import type { BudgetCategory, BudgetTag } from "../../src/api/budget";
import type { BreakdownRow, BudgetSummary, BudgetTrend, CategoryRef, Figure, Slice, SliceAmount } from "../../src/api/overview";
import type { Transaction, TransactionCounts } from "../../src/api/types";
import type { CategoryRow, TxnRow } from "../data/base";
import { dayOf, isoDay, money } from "../data/util";
import type { Store } from "../store";

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

export function transactionView(store: Store, x: TxnRow): Transaction {
  const a = store.accounts.find((acc) => acc.id === x.accountId)!;
  const c = store.categories.find((cat) => cat.id === x.categoryId) ?? null;
  const sec = x.holdingId ? store.securities.find((s) => s.id === x.holdingId) : undefined;
  return {
    id: x.id,
    t: x.t,
    type: x.type,
    description: x.description,
    amount: money(x.amount),
    amountReporting: money(x.amount),
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

function ids(q: URLSearchParams, key: string): string[] {
  return (q.get(key) ?? "").split(",").filter(Boolean);
}

/** The rows a filter selects, newest first — the list, counts and bulk share it. */
export function matching(store: Store, q: URLSearchParams, opts: { ignoreTransfers?: boolean } = {}): TxnRow[] {
  const search = q.get("search")?.toLowerCase();
  const accountId = q.get("accountId");
  const bucket = q.get("bucket") ?? "all";
  const from = q.get("from");
  const to = q.get("to");
  const catIds = ids(q, "categoryIds");
  const tagIds = ids(q, "tagIds");
  return store.txns.filter((x) => {
    if (!opts.ignoreTransfers && x.isTransfer && q.get("includeTransfers") !== "true") return false;
    if (search && !(x.description ?? "").toLowerCase().includes(search)) return false;
    if (accountId && x.accountId !== accountId) return false;
    if (bucket === "in" && !(x.source === "cash" && x.amount > 0)) return false;
    if (bucket === "out" && !(x.source === "cash" && x.amount < 0)) return false;
    if (bucket === "lots" && x.source !== "lot") return false;
    if (from && x.t < dayOf(from)) return false;
    if (to && x.t > dayOf(to)) return false;
    if (catIds.length && !catIds.includes(x.categoryId ?? "")) return false;
    if (tagIds.length && !tagIds.every((t) => x.tagIds.includes(t))) return false;
    if (q.get("uncategorized") === "true" && x.categoryId !== null) return false;
    if (q.get("needsReview") === "true" && !x.needsReview) return false;
    return true;
  });
}

export function transactions(store: Store, q: URLSearchParams): Transaction[] {
  const limit = Number(q.get("limit") ?? 200);
  const offset = Number(q.get("offset") ?? 0);
  return matching(store, q)
    .slice(offset, offset + limit)
    .map((x) => transactionView(store, x));
}

export function counts(store: Store, q: URLSearchParams): TransactionCounts {
  const rows = matching(store, q);
  const visible = store.txns.filter((x) => !x.isTransfer);
  return {
    matching: rows.length,
    total: visible.length,
    uncategorized: visible.filter((x) => x.categoryId === null).length,
    matchingTotal: money(rows.reduce((s, x) => s + x.amount, 0)),
    fxMissing: false,
  };
}

// ── Overview ────────────────────────────────────────────────────────────────

type Month = string; // "YYYY-MM"

function monthOf(t: number): Month {
  return isoDay(t).slice(0, 7);
}

function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function ref(c: CategoryRow): CategoryRef {
  return { id: c.id, name: c.name, defaultKey: c.defaultKey, color: c.color, icon: c.icon };
}

/** Budget rows: cash only (a lot is not spending), no neutral category. */
function budgetRows(store: Store): (TxnRow & { cat: CategoryRow | null })[] {
  return store.txns
    .filter((x) => x.source === "cash")
    .map((x) => ({ ...x, cat: store.categories.find((c) => c.id === x.categoryId) ?? null }))
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

/** Keeps at most `cap` slices of at least 2% of `total`; the rest becomes Other. */
function collapse(store: Store, entries: [string, number][], total: number, cap: number): SliceAmount[] {
  const kept = entries.filter(([, v]) => v >= total * 0.02).slice(0, cap);
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

function monthEnd(m: Month): string {
  const next = dayOf(`${addMonths(m, 1)}-01`);
  return isoDay(next - 86_400_000);
}

export function summary(store: Store, q: URLSearchParams): BudgetSummary {
  const all = budgetRows(store);
  const month = q.get("month");
  const from = month ? `${month}-01` : q.get("from")!;
  const to = month ? monthEnd(month) : q.get("to")!;
  const rows = inPeriod(all, from, to);
  const exp = expenseSide(rows);
  const inc = incomeSide(rows);
  const income = sum(inc);
  const expenses = sum(exp);

  // Comparisons only for a month with three full months of history before it.
  const firstMonth = all.length ? monthOf(Math.min(...all.map((x) => x.t))) : null;
  const history = month && firstMonth ? Array.from({ length: 12 }, (_, i) => addMonths(month, -12 + i)).filter((m) => m >= firstMonth) : [];
  const compare = history.length >= 3;
  const avgOf = (f: (r: Row[]) => number) => history.reduce((s, m) => s + f(monthRows(all, m)), 0) / Math.max(1, history.length);
  const figure = (amount: number, f: (r: Row[]) => number): Figure =>
    month && compare
      ? { amount: money(amount), prevMonth: money(f(monthRows(all, addMonths(month, -1)))), avg12: money(Math.round(avgOf(f))) }
      : { amount: money(amount) };
  const incomeOf = (r: Row[]) => sum(incomeSide(r));
  const expensesOf = (r: Row[]) => sum(expenseSide(r));

  const remainder = income - expenses;
  const breakdownEntries = sorted(exp);
  const breakdown: BreakdownRow[] = breakdownEntries.slice(0, 7).map(([k, v]) => {
    const row: BreakdownRow = {
      slice: slice(store, k),
      amount: money(v),
      txnCount: rows.filter((x) => (k === UNCAT ? !x.cat && x.amount < 0 : x.cat?.id === k)).length,
    };
    if (compare) row.avg12 = money(avgOf((r) => expenseSide(r).get(k) ?? 0));
    return row;
  });
  const rest = breakdownEntries.slice(7);
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
      sources: collapse(store, sorted(inc), expenses, 8),
      destinations: collapse(store, sorted(exp), expenses, 8),
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
  const fold = store.categories.find((c) => c.defaultKey === "other_expense")?.id;
  const kept = sorted(totals).map(([k]) => k).filter((k) => k !== fold).slice(0, 8);
  const series = kept.map((k) => ({ slice: slice(store, k), values: perMonth.map((m) => money(m.get(k) ?? 0)) }));
  const otherValues = perMonth.map((m) => [...m.entries()].filter(([k]) => !kept.includes(k)).reduce((s, [, v]) => s + v, 0));
  if (otherValues.some((v) => v > 0)) series.push({ slice: { kind: "other" }, values: otherValues.map((v) => money(v)) });
  return { months, series };
}
