// Valuations computed from the store, so a write (a lot, a transaction) shows
// up everywhere at once. Everything is EUR; FX states are forced per screen.

import type {
  Account,
  AccountSeries,
  Holding,
  InvestmentReturns,
  Lot,
  NetWorthResponse,
  PricePoint,
  ProviderGroup,
  ReturnFigures,
} from "../../src/api/types";
import { HISTORY_DAYS, dayIndex, type SecurityRow } from "../data/base";
import { DAY_MS, TODAY, isoDay, money, rangeDays } from "../data/util";
import type { Store } from "../store";

/** Every lot of a security: provider lots from the ledger, plus manual ones. */
export function lotsOf(store: Store, holdingId: string): Lot[] {
  const fromLedger: Lot[] = store.txns
    .filter((x) => x.source === "lot" && x.holdingId === holdingId)
    .map((x) => ({
      id: x.id,
      t: x.t,
      side: x.type === "sell" ? "sell" : "buy",
      qty: String(x.quantity),
      price: money(x.unitPrice ?? 0),
      fee: money(x.fee ?? 0),
      manual: false,
    }));
  return [...fromLedger, ...(store.manualLots[holdingId] ?? [])].sort((a, b) => a.t - b.t);
}

function lotQty(l: Lot): number {
  return (l.side === "sell" ? -1 : 1) * Number(l.qty);
}

/** Per-day series, index 0 = oldest history day, last = today. */
type Daily = Record<string, number[]>;

function cashDaily(store: Store): Daily {
  const out: Daily = {};
  for (const a of store.accounts) {
    const deltas = new Array<number>(HISTORY_DAYS).fill(0);
    for (const x of store.txns) {
      if (x.accountId !== a.id) continue;
      const i = dayIndex(x.t);
      if (i >= 0 && i < HISTORY_DAYS) deltas[i] += x.amount;
    }
    let v = store.openingCash[a.id] ?? 0;
    out[a.id] = deltas.map((d) => (v += d));
  }
  return out;
}

function qtyDaily(store: Store, s: SecurityRow): number[] {
  const deltas = new Array<number>(HISTORY_DAYS).fill(0);
  for (const l of lotsOf(store, s.id)) deltas[Math.max(0, dayIndex(l.t))] += lotQty(l);
  let q = 0;
  return deltas.map((d) => (q += d));
}

function costDaily(store: Store, s: SecurityRow): number[] {
  const deltas = new Array<number>(HISTORY_DAYS).fill(0);
  for (const l of lotsOf(store, s.id)) {
    if (l.side === "buy") deltas[Math.max(0, dayIndex(l.t))] += Number(l.qty) * Number(l.price) + Number(l.fee);
  }
  let c = 0;
  return deltas.map((d) => (c += d));
}

/** Value and invested amount per account per day. */
function accountDaily(store: Store): { value: Daily; invested: Daily } {
  const cash = cashDaily(store);
  const value: Daily = {};
  const invested: Daily = {};
  for (const a of store.accounts) {
    value[a.id] = [...cash[a.id]];
    invested[a.id] = [...cash[a.id]];
  }
  for (const s of store.securities) {
    // A security with no exchange rate is left out of every sum, as the server does.
    if (store.fx.missing.includes(s.id)) continue;
    const q = qtyDaily(store, s);
    const c = costDaily(store, s);
    // What the provider reports today, even when the lots don't explain it.
    if (s.reportedQty !== undefined) q[HISTORY_DAYS - 1] = s.reportedQty;
    for (let i = 0; i < HISTORY_DAYS; i++) {
      value[s.accountId][i] += q[i] * s.closes[i];
      invested[s.accountId][i] += c[i];
    }
  }
  return { value, invested };
}

function dayT(i: number): number {
  return TODAY - (HISTORY_DAYS - 1 - i) * DAY_MS;
}

function firstIndex(range: string): number {
  return Math.max(0, HISTORY_DAYS - 1 - rangeDays(range));
}

export function netWorth(store: Store, range: string): NetWorthResponse {
  // Like the server: no accounts, no points, and a zero summary.
  if (store.accounts.length === 0) {
    return {
      points: [],
      summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false },
    };
  }
  const { value, invested } = accountDaily(store);
  const ids = store.accounts.map((a) => a.id);
  const points = [];
  for (let i = firstIndex(range); i < HISTORY_DAYS; i++) {
    const nw = ids.reduce((s, id) => s + value[id][i], 0);
    const inv = ids.reduce((s, id) => s + invested[id][i], 0);
    points.push({ t: dayT(i), netWorth: money(nw), invested: money(inv) });
  }
  const first = Number(points[0].netWorth);
  const last = Number(points[points.length - 1].netWorth);
  return {
    points,
    summary: {
      netWorth: money(last),
      invested: points[points.length - 1].invested,
      gainAbs: money(last - first),
      gainPct: first === 0 ? "0" : ((last - first) / first).toFixed(4),
      fxMissing: store.fx.missing.length > 0,
    },
  };
}

export function accountSeries(store: Store, range: string): AccountSeries {
  const { value } = accountDaily(store);
  const points = [];
  for (let i = firstIndex(range); i < HISTORY_DAYS; i++) {
    points.push({ t: dayT(i), values: Object.fromEntries(store.accounts.map((a) => [a.id, money(value[a.id][i])])) });
  }
  return { accounts: store.accounts.map(({ id, name, color }) => ({ id, name, color })), points };
}

function lastSyncOf(store: Store, connectionId: string): number | null {
  return store.connections.find((c) => c.id === connectionId)?.lastSyncAt ?? null;
}

export function accounts(store: Store): Account[] {
  const { value } = accountDaily(store);
  return store.accounts.map((a) => ({
    ...a,
    value: money(value[a.id][HISTORY_DAYS - 1]),
    valueNative: null,
    lastSyncAt: lastSyncOf(store, a.connectionId),
    fxMissing: store.securities.some((s) => s.accountId === a.id && store.fx.missing.includes(s.id)),
  }));
}

export function connections(store: Store): ProviderGroup[] {
  const accs = accounts(store);
  const groups: ProviderGroup[] = [];
  for (const c of store.connections) {
    const { providerKey, ...conn } = c;
    let g = groups.find((x) => x.providerKey === providerKey);
    if (!g) {
      const p = store.providers.find((x) => x.key === providerKey);
      g = { providerKey, providerName: p?.displayName ?? providerKey, connections: [] };
      groups.push(g);
    }
    g.connections.push({
      ...conn,
      accounts: accs
        .filter((a) => a.connectionId === c.id)
        .map((a) => ({ id: a.id, name: a.name, color: a.color, typeKey: a.typeKey, value: a.value, lastSyncAt: a.lastSyncAt, health: c.health })),
    });
  }
  return groups;
}

function holdingBase(store: Store, accountId: string) {
  const a = store.accounts.find((x) => x.id === accountId)!;
  return { accountId, accountName: a.name, accountColor: a.color, accountType: a.typeKey, accountCurrency: a.currency, fxMissing: false, logo: null };
}

const USD_PER_EUR = 1.08;

export function holdings(store: Store): Holding[] {
  const cash = cashDaily(store);
  const out: Holding[] = store.accounts.map((a) => {
    const v = money(cash[a.id][HISTORY_DAYS - 1]);
    return {
      ...holdingBase(store, a.id),
      id: `cash-${a.id}`,
      ticker: "EUR",
      name: "Euro",
      kind: "cash",
      qty: v,
      price: "1",
      currency: "EUR",
      priceCurrency: "EUR",
      invested: v,
      investedNative: v,
      value: v,
      valueNative: v,
      gl: "0",
      glPct: "0",
      spark: null,
      composition: null,
      unexplainedQty: "0",
      meanPrice: "0",
      unexplainedCost: "0",
    };
  });
  for (const s of store.securities) {
    const lots = lotsOf(store, s.id);
    const explained = lots.reduce((q, l) => q + lotQty(l), 0);
    const qty = s.reportedQty ?? explained;
    const missingFx = store.fx.missing.includes(s.id);
    const buys = lots.filter((l) => l.side === "buy");
    const boughtQty = buys.reduce((q, l) => q + Number(l.qty), 0);
    const boughtCost = buys.reduce((c, l) => c + Number(l.qty) * Number(l.price) + Number(l.fee), 0);
    const mean = boughtQty === 0 ? 0 : boughtCost / boughtQty;
    const price = s.closes[HISTORY_DAYS - 1];
    const invested = mean * explained;
    const value = missingFx ? 0 : qty * price;
    out.push({
      ...holdingBase(store, s.accountId),
      fxMissing: missingFx,
      id: s.id,
      ticker: s.ticker,
      name: s.name,
      kind: "etf",
      qty: String(qty),
      price: money(price),
      // A missing rate stands for a listing quoted in dollars.
      currency: missingFx ? "USD" : "EUR",
      priceCurrency: missingFx ? "USD" : "EUR",
      invested: money(invested),
      investedNative: money(invested),
      value: money(value),
      valueNative: money(qty * price * (missingFx ? USD_PER_EUR : 1)),
      gl: missingFx ? "0" : money(value - invested),
      glPct: missingFx || invested === 0 ? "0" : ((value - invested) / invested).toFixed(4),
      spark: s.closes.slice(-30).map((p) => money(p)),
      composition: s.composition,
      unexplainedQty: String(qty - explained),
      meanPrice: money(mean),
      unexplainedCost: money(Math.max(0, qty - explained) * mean),
    });
  }
  return out;
}

export function prices(store: Store, holdingId: string, range: string): PricePoint[] {
  const s = store.securities.find((x) => x.id === holdingId);
  if (!s) return [];
  const out: PricePoint[] = [];
  for (let i = Math.max(firstIndex(range), s.listedFrom ?? 0); i < HISTORY_DAYS; i++) {
    const p = money(s.closes[i]);
    out.push({ t: dayT(i), price: p, accountPrice: p, reportingPrice: p });
  }
  return out;
}

export function returns(store: Store): InvestmentReturns {
  const hs = holdings(store).filter((h) => h.kind !== "cash");
  const figures = (rows: Holding[], since: string | null): ReturnFigures => {
    const invested = rows.reduce((s, h) => s + Number(h.invested), 0);
    const value = rows.reduce((s, h) => s + Number(h.value), 0);
    return {
      annualised: invested === 0 ? null : "0.0712",
      since,
      invested: money(invested),
      value: money(value),
      gl: money(value - invested),
      glPct: invested === 0 ? "0" : ((value - invested) / invested).toFixed(4),
    };
  };
  const firstLot = Math.min(...store.securities.flatMap((s) => lotsOf(store, s.id).map((l) => l.t)));
  const since = Number.isFinite(firstLot) ? isoDay(firstLot) : null;
  const investAccounts = store.accounts.filter((a) => hs.some((h) => h.accountId === a.id));
  return {
    today: isoDay(TODAY),
    total: figures(hs, since),
    accounts: investAccounts.map((a) => ({
      ...figures(hs.filter((h) => h.accountId === a.id), since),
      id: a.id,
      name: a.name,
      color: a.color,
      source: a.sourceName ?? "",
      missing: hs.filter((h) => h.accountId === a.id && Number(h.unexplainedQty) !== 0).map((h) => ({ id: h.id, name: h.name })),
    })),
  };
}
