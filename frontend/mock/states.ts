// States for the review panel, added as each piece of the UI is reviewed.
// Each one tweaks the base data (or forces an answer); several can be on at
// once, unless they share a `group`, and Reset re-applies the active ones on
// fresh data. The panel lists the
// states of the piece under review (`FOCUS`).

import { BANK, BROKER, CHECKING, CW8, ESE, HISTORY_DAYS, PEA, SP500, WORLD, closes } from "./data/base";
import { TODAY, daysAgo, id, isoDay } from "./data/util";
import type { Store } from "./store";
import { lotsOf } from "./views/portfolio";
import { summary } from "./views/budget";

export type MockState = {
  id: string;
  label: string;
  /** The pieces of the UI it shows something on. */
  pieces: string[];
  /** States that can't be on together share a group; the panel shows the
   *  group as one segmented control, each state as its `option`. */
  group?: string;
  option?: string;
  apply(store: Store): void;
};

/** Shares the recorded lots explain. */
function lotShares(store: Store, holdingId: string): number {
  return lotsOf(store, holdingId).reduce((q, l) => q + (l.side === "sell" ? -1 : 1) * Number(l.qty), 0);
}

function security(store: Store, id: string) {
  return store.securities.find((s) => s.id === id)!;
}

/** No accounts, holdings or transactions; connections left as they are. */
function emptyHousehold(store: Store) {
  store.accounts = [];
  store.securities = [];
  store.txns = [];
  store.openingCash = {};
}

type Health = { verified?: boolean; lastUpdatedOn?: string | null; state?: string | null; errorMessage?: string | null; nextRetryOn?: string | null };

function health(h: Health = {}) {
  return { verified: true, lastUpdatedOn: isoDay(TODAY), state: null, errorMessage: null, nextRetryOn: null, ...h };
}

/** One more Powens connection holding one account (none: `account` null). */
function extraConnection(store: Store, n: number, displayName: string, conn: Partial<Store["connections"][number]> = {}, account: string | null = "Compte courant") {
  const connectionId = id("con", 10 + n);
  const accountId = id("acc", 30 + n);
  store.connections.push({ providerKey: "powens", id: connectionId, displayName, status: "ok", lastSyncAt: Date.now() - 2 * 3_600_000, lastError: null, logo: null, canManage: true, health: health(), ...conn });
  if (account === null) return;
  store.accounts.push({ id: accountId, connectionId, name: account, color: "#f0b952", typeKey: "checking", currency: "EUR", sourceName: displayName, sourceLogo: null });
  store.openingCash[accountId] = 500 + 100 * n;
}

/** Bank data last updated `days` ago. */
const staleDay = (days: number) => isoDay(daysAgo(days));

/** One more account at the bank, holding `cash` today. */
function extraAccount(store: Store, n: number, name: string, typeKey: string, color: string, cash: number) {
  const accountId = id("acc", 10 + n);
  store.accounts.push({ id: accountId, connectionId: BANK, name, color, typeKey, currency: "EUR", sourceName: "Crédit Mutuel", sourceLogo: null });
  store.openingCash[accountId] = cash;
}

/** DCAM.PA in the PEA, as production stores it; returns its id. */
function addDcam(store: Store): string {
  // Public market data as production stores it: the Yahoo ticker, the
  // provider's name, a price near 6,30 €, prices only from the fund's
  // launch (4 March 2025), and Boursorama's composition as of October
  // 2026. Quantities and dates of the purchases are made up.
  const sec = id("hol", 60);
  const launch = HISTORY_DAYS - 1 - Math.round((TODAY - Date.UTC(2025, 2, 4)) / 86_400_000);
  const c = closes(60, 6.301, 0.0005, 0.011);
  store.securities.push({
    id: sec,
    accountId: PEA,
    ticker: "DCAM.PA",
    name: "AMUNDI PEA MONDE MSCI WORLD UCITS ETF ACC",
    closes: c,
    listedFrom: launch,
    composition: {
      countries: [
        ["Etats-Unis", 0.7276], ["Japon", 0.0591], ["Royaume-Uni", 0.0333], ["Canada", 0.033], ["Suisse", 0.0245],
        ["Allemagne", 0.0205], ["France", 0.0199], ["Australie", 0.0155], ["Pays-Bas", 0.0149], ["Espagne", 0.0093],
      ].map(([name, weight]) => ({ name: name as string, weight: weight as number })),
      sectors: [
        ["Technologie", 0.325], ["Finance", 0.1553], ["Produits industriels", 0.1046], ["Santé", 0.092],
        // Sent twice by Boursorama (8,24 % and 4,73 %), stored merged by the adapter.
        ["Télécommunications", 0.0838], ["Biens de consommation cycliques", 0.1297],
        ["Énergie", 0.0404], ["Matières non énergétiques", 0.0306], ["Services publics", 0.0226],
      ].map(([name, weight]) => ({ name: name as string, weight: weight as number })),
    },
  });
  // A buy every two months from a month after launch.
  store.manualLots[sec] = [];
  for (let i = launch + 30, n = 0; i < HISTORY_DAYS; i += 61, n++) {
    store.manualLots[sec].push({
      id: id("lot", 60 + n), t: daysAgo(HISTORY_DAYS - 1 - i), side: "buy", qty: "80", price: c[i].toFixed(3), fee: "0", manual: true,
    });
  }
  return sec;
}

/** Every purchase older than `days` forgotten, as if the investing started
 *  then; what is held follows the lots left. */
function investedSince(store: Store, days: number) {
  const from = daysAgo(days);
  for (const s of store.securities) {
    store.deletedLots.push(...lotsOf(store, s.id).filter((l) => l.t < from).map((l) => l.id));
    store.manualLots[s.id] = (store.manualLots[s.id] ?? []).filter((l) => l.t >= from);
  }
  store.securities = store.securities.filter((s) => lotsOf(store, s.id).length > 0);
}

/** This month's net (income − expenses), as the overview shows it. */
function monthNet(store: Store): number {
  const month = isoDay(TODAY).slice(0, 7);
  return Number(summary(store, new URLSearchParams({ month })).figures.net.amount);
}

/** One more expense today, in the first expense category. */
function addExpense(store: Store, n: number, description: string, amount: number) {
  const row = store.txns.find((x) => x.accountId === CHECKING && x.source === "cash")!;
  const category = store.categories.find((c) => c.kind === "expense")!;
  store.txns.unshift({
    ...row,
    id: id("txn", 900 + n),
    t: TODAY,
    description,
    amount: -amount,
    categoryId: category.id,
    categorySource: "user",
    categoryConfidence: null,
    needsReview: false,
    isTransfer: false,
    tagIds: [],
  });
}

/** One more cash row, `days` ago, in category `categoryKey` (filed by the user). */
function addRow(store: Store, n: number, accountId: string, days: number, description: string, amount: number, categoryKey: string | null, extra: Partial<Store["txns"][number]> = {}) {
  const category = categoryKey === null ? null : store.categories.find((c) => c.defaultKey === categoryKey)!;
  const row: Store["txns"][number] = {
    id: id("txn", 950 + n), t: daysAgo(days), type: amount < 0 ? "card" : "transfer", description, amount, accountId,
    source: "cash", holdingId: null, quantity: null, unitPrice: null, fee: null,
    categoryId: category?.id ?? null, categorySource: category ? "user" : null, categoryConfidence: null,
    needsReview: false, checked: false, isTransfer: false, isOrphanTransfer: false, tagIds: [], ...extra,
  };
  store.txns.push(row);
  store.txns.sort((a, b) => b.t - a.t || b.id.localeCompare(a.id));
  return row;
}

/** Puts this month's cash rows `pick` selects in the review queue as the AI's
 *  unsure guesses (`categoryKey` null: it abstained). */
function queue(store: Store, count: number, categoryKey: string | null, pick: (x: Store["txns"][number]) => boolean = () => true) {
  const from = daysAgo(30);
  const category = categoryKey === null ? null : store.categories.find((c) => c.defaultKey === categoryKey || c.name === categoryKey) ?? null;
  return store.txns
    .filter((x) => x.source === "cash" && x.t >= from && !x.needsReview && pick(x))
    .slice(0, count)
    .map((x, i) => {
      Object.assign(x, { needsReview: true, categoryId: category?.id ?? null, categorySource: category ? "ai" : null, categoryConfidence: category ? (0.5 + (i % 3) * 0.05).toFixed(2) : null });
      return x;
    });
}

/** The piece under review: the panel lists its states. */
export const FOCUS = "Sign-in pages";

export const STATES: MockState[] = [
  // ── Distribution ──
  {
    id: "distribution-overdraft",
    label: "Checking account overdrawn (negative balance)",
    pieces: ["Distribution", "Accounts chart", "Accounts list"],
    apply(store) {
      const row = store.txns.find((x) => x.accountId === CHECKING && x.source === "cash")!;
      store.txns.unshift({
        ...row,
        id: "00000000-0000-4000-8000-0000000ovrd1",
        t: daysAgo(2),
        description: "PRLV SEPA LOYER",
        amount: -4500,
        categoryId: null,
        categorySource: null,
        categoryConfidence: null,
        needsReview: false,
        isTransfer: false,
        tagIds: [],
      });
    },
  },
  {
    id: "distribution-empty-account",
    label: "An account at 0 € (emptied savings book)",
    pieces: ["Distribution", "Accounts list"],
    apply(store) {
      extraAccount(store, 1, "LDDS", "savings", "#f0b952", 0);
    },
  },
  {
    id: "distribution-many",
    label: "12 accounts, long names, tiny ones",
    pieces: ["Distribution", "Accounts chart", "Accounts list", "Edit account"],
    apply(store) {
      const more: [string, string, number][] = [
        ["Compte joint Camille et Alex", "checking", 1840],
        ["Livret Développement Durable et Solidaire", "savings", 4200],
        ["Livret Jeune", "savings", 1600],
        ["PEL", "savings", 7300],
        ["Compte à terme 2027", "savings", 3000],
        ["Assurance vie Linxea Spirit 2", "brokerage", 12500],
        ["CEL", "savings", 310],
        ["Compte courant pro", "checking", 42],
        ["Cagnotte vacances", "savings", 12],
      ];
      more.forEach(([name, type, cash], i) =>
        extraAccount(store, 2 + i, name, type, ["#f08fb0", "#9bb06b", "#e88a5f", "#6aa0e0", "#b8a8f0", "#5fcf9e", "#5b9bf0", "#4dd0b1", "#b07ef0"][i], cash),
      );
    },
  },
  {
    id: "distribution-all-zero",
    label: "Every account at 0 €",
    pieces: ["Investments", "Distribution", "Net worth chart", "Holdings", "Accounts chart", "Accounts list"],
    group: "Data",
    option: "Zero",
    apply(store) {
      emptyHousehold(store);
      extraAccount(store, 20, "Compte courant", "checking", "#60b4f5", 0);
      extraAccount(store, 21, "Livret A", "savings", "#34d399", 0);
    },
  },
  // ── Asset window ──
  {
    id: "asset-dcam",
    label: "DCAM.PA in the PEA (launched March 2025, ~6 € a share)",
    pieces: ["Asset window", "Holdings"],
    apply(store) {
      addDcam(store);
    },
  },
  // ── Record purchases ──
  {
    id: "record-no-lots",
    label: "DCAM.PA held, no purchase recorded at all",
    pieces: ["Investments", "Record purchases", "Holdings"],
    apply(store) {
      const sec = addDcam(store);
      security(store, sec).reportedQty = lotShares(store, sec);
      store.manualLots[sec] = [];
    },
  },
  {
    id: "record-provider-lots",
    label: "CW8: the broker sent its first 4 buys (locked), 3 shares unexplained",
    pieces: ["Record purchases"],
    apply(store) {
      const first = lotsOf(store, CW8).slice(0, 4);
      store.providerLots.push(...first.map((l) => l.id));
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
    },
  },
  {
    id: "record-suggestions",
    label: "CW8 3 shares short, 3 buys pre-filled from the cash ledger",
    pieces: ["Record purchases"],
    apply(store) {
      const c = security(store, CW8).closes;
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
      store.lotSuggestions[CW8] = [400, 280, 150].map((ago) => ({
        type: "buy" as const,
        date: new Date(daysAgo(ago)).toISOString().slice(0, 10),
        quantity: "1",
        unitPrice: c[HISTORY_DAYS - 1 - ago].toFixed(2),
        fee: "1.99",
      }));
    },
  },
  {
    id: "asset-sold",
    label: "CW8: 2 shares sold last month",
    pieces: ["Asset window", "Record purchases"],
    apply(store) {
      const c = security(store, CW8).closes;
      store.manualLots[CW8] = [
        ...(store.manualLots[CW8] ?? []),
        { id: id("lot", 90), t: daysAgo(25), side: "sell", qty: "2", price: c[HISTORY_DAYS - 26].toFixed(2), fee: "1.99", manual: true },
      ];
      // The provider's quantity follows the sale.
      security(store, CW8).reportedQty = lotShares(store, CW8);
    },
  },
  {
    id: "asset-no-composition",
    label: "ESE has no composition (not an ETF Boursorama knows)",
    pieces: ["Asset window"],
    apply(store) {
      security(store, ESE).composition = null;
    },
  },
  // ── Investments ──
  {
    id: "investments-months",
    label: "Investing for 5 months only (the return in amber)",
    pieces: ["Investments", "Holdings", "Asset window"],
    group: "Started",
    option: "Months",
    apply(store) {
      investedSince(store, 150);
    },
  },
  {
    id: "investments-days",
    label: "First purchase a few days ago",
    pieces: ["Investments", "Holdings", "Asset window"],
    group: "Started",
    option: "Days",
    apply(store) {
      investedSince(store, 12);
    },
  },
  {
    id: "investments-none-complete",
    label: "Every security has purchases missing (return unknown)",
    pieces: ["Investments", "Holdings"],
    apply(store) {
      for (const s of store.securities) s.reportedQty = lotShares(store, s.id) + 1;
    },
  },
  // ── Budget overview ──
  {
    id: "budget-to-review",
    label: "The AI filed 9 transactions it isn't sure of (to review)",
    pieces: ["Budget transactions", "Budget overview", "Budget review"],
    apply(store) {
      const from = daysAgo(30);
      store.txns
        .filter((x) => x.source === "cash" && x.t >= from && x.categorySource === "ai" && !x.isTransfer)
        .slice(0, 9)
        .forEach((x, i) => {
          x.needsReview = true;
          x.categoryConfidence = (0.45 + (i % 4) * 0.05).toFixed(2);
        });
    },
  },
  {
    id: "budget-ai-running",
    label: "The AI is sorting 42 transactions",
    pieces: ["Budget overview"],
    group: "AI",
    option: "Running",
    apply(store) {
      store.aiStatus = { ...store.aiStatus, running: true, remaining: 42 };
    },
  },
  {
    id: "budget-ai-failed",
    label: "The AI's last run failed",
    pieces: ["Budget overview"],
    group: "AI",
    option: "Failed",
    apply(store) {
      store.aiStatus = {
        ...store.aiStatus,
        lastRun: { outcome: "error", error: "The AI server didn't answer in time (timeout after 120 s).", startedAt: new Date(TODAY).toISOString() },
      };
    },
  },
  {
    id: "budget-young",
    label: "Only 2 months of history (no comparisons)",
    pieces: ["Budget overview"],
    apply(store) {
      const from = daysAgo(45);
      store.txns = store.txns.filter((x) => x.source !== "cash" || x.t >= from);
    },
  },
  {
    id: "budget-overspent",
    label: "This month drew from savings",
    pieces: ["Budget overview"],
    group: "Month",
    option: "Overspent",
    apply(store) {
      addExpense(store, 1, "FACTURE GARAGE REPARATION", Math.max(0, monthNet(store)) + 850);
    },
  },
  {
    id: "budget-break-even",
    label: "This month ended at exactly 0",
    pieces: ["Budget overview"],
    group: "Month",
    option: "Zero",
    apply(store) {
      const net = monthNet(store);
      if (net > 0) addExpense(store, 2, "VIREMENT LOYER", net);
    },
  },
  // ── Budget review ──
  {
    id: "review-hides-money",
    label: "A guess into Savings (hides the amount from the totals)",
    pieces: ["Budget review"],
    apply(store) {
      queue(store, 1, "savings", (x) => x.amount < 0 && !x.isTransfer);
    },
  },
  {
    id: "review-no-guess",
    label: "Two rows the AI couldn't guess",
    pieces: ["Budget review"],
    apply(store) {
      queue(store, 2, null, (x) => !x.isTransfer);
    },
  },
  {
    id: "review-same-description",
    label: "A guess whose description 5 other rows share",
    pieces: ["Budget review"],
    apply(store) {
      const [row] = queue(store, 1, "groceries", (x) => x.amount < 0 && !x.isTransfer);
      store.txns.filter((x) => x.source === "cash" && x !== row && x.amount < 0 && !x.isTransfer && !x.needsReview).slice(0, 5)
        .forEach((x) => { x.description = row.description; });
    },
  },
  {
    id: "review-paired",
    label: "A guess on a paired transfer (correcting it breaks the pair)",
    pieces: ["Budget review"],
    apply(store) {
      const [row] = queue(store, 1, "internal", (x) => x.amount < 0);
      row.isTransfer = true;
    },
  },
  {
    id: "review-many",
    label: "260 rows to review (loads as you scroll)",
    pieces: ["Budget review"],
    apply(store) {
      store.txns.filter((x) => x.source === "cash" && !x.isTransfer).slice(0, 260).forEach((x, i) => {
        Object.assign(x, { needsReview: true, categorySource: x.categoryId ? "ai" : null, categoryConfidence: x.categoryId ? (0.45 + (i % 5) * 0.04).toFixed(2) : null });
      });
    },
  },
  // ── Budget transactions ──
  {
    id: "transactions-none",
    label: "No transactions at all",
    pieces: ["Budget transactions"],
    apply(store) {
      store.txns = [];
    },
  },
  {
    id: "transactions-dollar",
    label: "A dollar account: 4 rows in $, the € value on hover",
    pieces: ["Budget transactions", "Exchange rates"],
    apply(store) {
      const accountId = id("acc", 40);
      store.accounts.push({ id: accountId, connectionId: BANK, name: "Wise USD", color: "#9da3fa", typeKey: "checking", currency: "USD", sourceName: "Crédit Mutuel", sourceLogo: null });
      store.openingCash[accountId] = 0;
      addRow(store, 1, accountId, 2, "CB WHOLE FOODS NYC", -84.37, "groceries");
      addRow(store, 2, accountId, 3, "CB UBER *TRIP", -23.9, "transport");
      addRow(store, 3, accountId, 4, "CB STARBUCKS 1234", -6.45, "restaurants");
      addRow(store, 4, accountId, 5, "VIR WISE CONVERSION EUR USD", 500, "internal");
    },
  },
  {
    id: "transactions-orphan",
    label: "A transfer whose other half was filed elsewhere (unpaired)",
    pieces: ["Budget transactions"],
    apply(store) {
      const out = store.txns.find((x) => x.isTransfer && x.description === "VIR VERS LIVRET A")!;
      const back = store.txns.find((x) => x.isTransfer && x.description === "VIR DEPUIS COMPTE COURANT" && x.t > out.t)!;
      Object.assign(out, { isTransfer: false, categoryId: store.categories.find((c) => c.defaultKey === "shopping")!.id, categorySource: "user" });
      Object.assign(back, { isTransfer: false, isOrphanTransfer: true });
    },
  },
  {
    id: "transactions-long",
    label: "A long description and 6 tags on one row",
    pieces: ["Budget transactions"],
    apply(store) {
      store.tags.push(
        { id: id("tag", 4), name: "Work expenses", color: "#cb93e2" },
        { id: id("tag", 5), name: "Shared with Alex", color: "#5fcf9e" },
        { id: id("tag", 6), name: "Tax-deductible", color: "#f0b952" },
      );
      addRow(store, 5, CHECKING, 1, "PRLV SEPA ASSOCIATION SPORTIVE ET CULTURELLE DU QUARTIER SAINT-AMBROISE COTISATION ANNUELLE 2026", -185, "sport", {
        tagIds: store.tags.map((t) => t.id),
      });
    },
  },
  {
    id: "transactions-sale",
    label: "A sale of ESE shares",
    pieces: ["Budget transactions", "Holdings", "Record purchases"],
    apply(store) {
      const price = security(store, ESE).closes[HISTORY_DAYS - 3];
      store.txns.push({
        id: id("txn", 970), t: daysAgo(2), type: "sell", description: null, amount: 5 * price - 1.99, accountId: PEA,
        source: "lot", holdingId: ESE, quantity: 5, unitPrice: price, fee: 1.99,
        categoryId: null, categorySource: null, categoryConfidence: null,
        needsReview: false, checked: false, isTransfer: false, isOrphanTransfer: false, tagIds: [],
      });
      store.txns.sort((a, b) => b.t - a.t || b.id.localeCompare(a.id));
    },
  },
  {
    id: "transactions-checked",
    label: "The ✓ column on (Settings · Budget)",
    pieces: ["Budget transactions"],
    apply(store) {
      store.user.prefs.showChecked = true;
    },
  },
  // ── Settings · General ──
  {
    id: "settings-us-formats",
    label: "US formats: MM/DD/YYYY, 1,234.56, $ before, New York",
    pieces: ["Settings general"],
    apply(store) {
      Object.assign(store.user.prefs, {
        dateFormat: "MM/DD/YYYY", numberGroupSep: ",", numberDecimalSep: ".", currencyPosition: "before", currency: "USD", timeZone: "America/New_York",
      });
    },
  },
  // ── Holdings ──
  {
    id: "holdings-many",
    label: "Life insurance with 7 funds: long names, fractions",
    pieces: ["Investments", "Holdings"],
    apply(store) {
      const account = id("acc", 40);
      store.accounts.push({ id: account, connectionId: BROKER, name: "Assurance vie Linxea Spirit 2", color: "#f0b952", typeKey: "life_insurance", currency: "EUR", sourceName: "Boursorama", sourceLogo: null });
      store.openingCash[account] = 1250;
      const funds: [string, string, number, number][] = [
        ["IWDA", "iShares Core MSCI World UCITS ETF USD (Acc)", 98.42, 42],
        ["PAEEM", "Amundi PEA MSCI Emerging Markets ESG Leaders UCITS ETF", 24.11, 120],
        ["BTCE", "WisdomTree Physical Bitcoin", 61430.5, 0.0421],
        ["SXR8", "iShares Core S&P 500 UCITS ETF", 612.9, 3.5],
        ["EUNA", "iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Dist)", 4.82, 900],
        ["FEX", "Fonds Euro Nouvelle Génération", 1, 3500],
        ["LVC", "Amundi ETF Leveraged MSCI USA Daily UCITS ETF", 14.2, 15],
      ];
      funds.forEach(([ticker, name, last, qty], i) => {
        const sec = id("hol", 40 + i);
        const c = closes(40 + i, last, 0.0002, 0.012);
        store.securities.push({ id: sec, accountId: account, ticker, name, closes: c, composition: i % 2 ? SP500 : WORLD });
        store.manualLots[sec] = [
          { id: id("lot", 40 + i), t: daysAgo(300), side: "buy", qty: String(qty), price: c[HISTORY_DAYS - 301].toFixed(2), fee: "0", manual: true },
        ];
      });
    },
  },
  // ── Dashboard ──
  {
    id: "dashboard-loss",
    label: "Net worth down: markets fell, a big payment left",
    pieces: ["Investments", "Net worth chart", "Accounts chart"],
    group: "Data",
    option: "Loss",
    apply(store) {
      // The last 180 days slide down to 45% below where they started.
      for (const s of store.securities) {
        const start = HISTORY_DAYS - 180;
        s.closes = s.closes.map((p, i) => (i < start ? p : Math.round(p * (1 - 0.45 * ((i - start) / 179)) * 100) / 100));
      }
      const row = store.txns.find((x) => x.accountId === CHECKING && x.source === "cash")!;
      store.txns.unshift({
        ...row,
        id: "00000000-0000-4000-8000-0000000loss1",
        t: daysAgo(20),
        description: "VIR SEPA NOTAIRE ACOMPTE",
        amount: -9000,
        categoryId: null,
        categorySource: null,
        categoryConfidence: null,
        needsReview: false,
        isTransfer: false,
        tagIds: [],
      });
    },
  },
  {
    id: "dashboard-fx-missing",
    label: "Two dollar ETFs have no rate (left out of totals)",
    pieces: ["Investments", "Exchange rates", "Net worth chart", "Distribution", "Holdings", "Asset window", "Accounts chart", "Accounts list"],
    apply(store) {
      store.fx.missing = [ESE, CW8];
    },
  },
  {
    id: "fx-budget",
    label: "Budget: a transaction has no rate",
    pieces: ["Budget transactions", "Budget overview", "Exchange rates"],
    apply(store) {
      store.fx.budget = true;
    },
  },
  {
    id: "fx-rate-down",
    label: "Currency change can't get its rate (Settings)",
    pieces: ["Settings general", "Exchange rates"],
    apply(store) {
      store.fx.rateDown = true;
    },
  },
  {
    id: "dashboard-lots-short",
    label: "Lots explain 3 shares fewer than CW8 holds",
    pieces: ["Investments", "Holdings", "Asset window", "Record purchases"],
    apply(store) {
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
    },
  },
  {
    id: "dashboard-lots-excess",
    label: "Lots explain 2 shares more than ESE holds",
    pieces: ["Investments", "Holdings", "Asset window", "Record purchases"],
    apply(store) {
      security(store, ESE).reportedQty = lotShares(store, ESE) - 2;
    },
  },
  {
    id: "dashboard-private",
    label: "Private mode on",
    pieces: ["Settings general", "Budget transactions", "Budget review", "Investments", "Net worth chart", "Distribution", "Holdings", "Asset window", "Record purchases", "Accounts chart", "Accounts list", "Edit account"],
    apply(store) {
      store.user.prefs.privateMode = true;
    },
  },
  {
    id: "dashboard-empty",
    label: "New user: nothing connected yet",
    pieces: ["Investments", "Net worth chart", "Distribution", "Holdings", "Accounts chart"],
    group: "Data",
    option: "New",
    apply(store) {
      emptyHousehold(store);
      store.connections = [];
    },
  },
  {
    id: "dashboard-first-sync",
    label: "Bank just connected, first sync running",
    pieces: ["Investments", "Net worth chart", "Distribution", "Holdings", "Accounts chart"],
    group: "Data",
    option: "Syncing",
    apply(store) {
      emptyHousehold(store);
      store.connections = [{ ...store.connections[0], status: "syncing", lastSyncAt: null }];
    },
  },
  {
    id: "dashboard-nothing-came-in",
    label: "Bank connected, no account came in",
    pieces: ["Investments", "Net worth chart", "Distribution", "Holdings", "Accounts chart"],
    group: "Data",
    option: "Empty",
    apply(store) {
      emptyHousehold(store);
      store.connections = [store.connections[0]];
    },
  },
  // ── Errors ──
  {
    id: "errors-reads-fail",
    label: "Nothing loads (every card's error)",
    pieces: ["Budget transactions", "Budget review", "Budget overview", "Investments", "Errors"],
    apply(store) {
      store.readsFail = true;
    },
  },
  {
    id: "errors-writes-fail",
    label: "Every save fails (the error in the corner)",
    pieces: ["Settings general", "Budget transactions", "Budget review", "Errors"],
    apply(store) {
      store.writesFail = true;
    },
  },
  {
    id: "errors-page-crash",
    label: "The pages showing accounts break",
    pieces: ["Errors"],
    apply(store) {
      store.accountsBroken = true;
    },
  },
  // ── Settings · Account ──
  {
    id: "account-two-factor-on",
    label: "Two-factor on, 3 recovery codes left",
    pieces: ["Settings · Account"],
    apply(store) {
      store.mfa = { ...store.mfa, totp: true, recoveryRemaining: 3 };
    },
  },
  {
    id: "account-passkeys",
    label: "Two passkeys",
    pieces: ["Settings · Account"],
    apply(store) {
      store.mfa = {
        ...store.mfa,
        passkeys: [
          { id: id("pk", 1), name: "MacBook Touch ID", createdAt: daysAgo(90), lastUsedAt: daysAgo(1) },
          { id: id("pk", 2), name: "YubiKey 5C", createdAt: daysAgo(30), lastUsedAt: null },
        ],
      };
    },
  },
  {
    id: "account-many-sessions",
    label: "Five sessions, one not remembered, one with no IP",
    pieces: ["Settings · Account"],
    group: "Sessions",
    option: "Five",
    apply(store) {
      store.sessions.push(
        { id: id("ses", 3), device: "Chrome on Windows", ip: "203.0.113.42", createdAt: daysAgo(3), lastActiveAt: daysAgo(3), remembered: false, current: false },
        { id: id("ses", 4), device: "Firefox on Android", ip: null, createdAt: daysAgo(70), lastActiveAt: daysAgo(25), remembered: true, current: false },
        { id: id("ses", 5), device: "Microsoft Edge on Windows with a very long device name", ip: "2001:db8:85a3::8a2e:370:7334", createdAt: daysAgo(1), lastActiveAt: Date.now() - 600_000, remembered: true, current: false },
      );
    },
  },
  {
    id: "account-only-session",
    label: "Only this session",
    pieces: ["Settings · Account"],
    group: "Sessions",
    option: "Only this one",
    apply(store) {
      store.sessions = store.sessions.filter((s) => s.current);
    },
  },
  // ── Settings · Connections ──
  {
    id: "connections-two-providers",
    label: "Two providers enabled (Add shows a picker)",
    pieces: ["Settings · Connections"],
    apply(store) {
      store.providers.push({ key: "bridge", displayName: "Bridge", description: "Banks through Bridge by Bankin'.", enabled: true });
    },
  },
  // ── Settings · Users ──
  {
    id: "users-several",
    label: "Five members, a long name and email",
    pieces: ["Settings · Users"],
    apply(store) {
      store.users.push(
        { id: id("usr", 3), name: "Jules", email: "jules@example.com", role: "user", joinedAt: daysAgo(30), isSelf: false },
        { id: id("usr", 4), name: "Marie-Charlotte de La Fontaine-Beaumont", email: "marie-charlotte.delafontaine-beaumont@example.com", role: "admin", joinedAt: daysAgo(400), isSelf: false },
        { id: id("usr", 5), name: "Sam", email: "sam@example.com", role: "user", joinedAt: daysAgo(2), isSelf: false },
      );
    },
  },
  // ── Settings · Server ──
  {
    id: "server-ai-off",
    label: "No AI provider chosen",
    pieces: ["Settings · Server"],
    apply(store) {
      store.aiSettings = { ...store.aiSettings, provider: null, model: null };
    },
  },
  {
    id: "server-ai-usage",
    label: "AI used by two models, one without prices",
    pieces: ["Settings · Server"],
    group: "AI usage",
    option: "Two models",
    apply(store) {
      store.aiUsage.models.push({ model: "jev-large", runs: 3, runsWithoutUsage: 1, tokensIn: 96_400, tokensOut: 9_210, priceIn: null, priceOut: null, cost: null });
    },
  },
  {
    id: "server-ai-unused",
    label: "AI never used",
    pieces: ["Settings · Server"],
    group: "AI usage",
    option: "None",
    apply(store) {
      store.aiUsage = { ...store.aiUsage, models: [], totalCost: "0" };
    },
  },
  // ── Sign-in pages ──
  // Log out to reach /login; /invite/any, /reset/any, /invite/expired;
  // /connections/callback?state=x (add &error=1 for a failure).
  {
    id: "login-two-factor",
    label: "Signing in asks for a code (000000 and the backup code \"wrong\" are refused)",
    pieces: ["Sign-in pages"],
    apply(store) {
      store.loginMfa = true;
    },
  },
  {
    id: "welcome-new",
    label: "A new account, at the welcome screen",
    pieces: ["Sign-in pages"],
    apply(store) {
      emptyHousehold(store);
      store.connections = [];
      store.user = { ...store.user, welcomeDone: false };
    },
  },
  {
    id: "welcome-no-ai",
    label: "No AI provider (the welcome screen has two steps)",
    pieces: ["Sign-in pages"],
    apply(store) {
      store.aiStatus = { ...store.aiStatus, configured: false };
    },
  },
  // ── Edit account ──
  {
    id: "edit-account-save-fails",
    label: "Saving an account fails",
    pieces: ["Edit account"],
    apply(store) {
      store.accountSaveFails = true;
    },
  },
  {
    id: "sync-every-status",
    label: "A connection in every status",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Every status",
    apply(store) {
      extraConnection(store, 1, "Société Générale", { status: "syncing" });
      extraConnection(store, 2, "Fortuneo", { status: "awaiting" });
      extraConnection(store, 3, "Hello bank!", { status: "pending", lastSyncAt: null, health: null }, null);
      extraConnection(store, 4, "Linxea", { status: "error", lastError: "provider fetch: powens: GET /users/me/connections/42/accounts: 503 Service Unavailable" }, "Assurance vie Linxea Spirit 2");
      extraConnection(store, 5, "La Banque Postale", { health: health({ state: "SCARequired" }) });
      extraConnection(store, 6, "Caisse d'Épargne Île-de-France", { health: health({ state: "wrongpass", errorMessage: null, nextRetryOn: staleDay(-2) }) }, "Livret Développement Durable et Solidaire");
      extraConnection(store, 7, "LCL", { health: health({ lastUpdatedOn: staleDay(6) }) });
      extraConnection(store, 8, "Banque Populaire", { health: health({ verified: false, lastUpdatedOn: null }) });
      // A partial update: the bank's checking account is fresh, the Livret A is not.
      store.accountHealth[id("acc", 2)] = health({ lastUpdatedOn: staleDay(9) });
    },
  },
  {
    id: "sync-one-syncing",
    label: "One connection syncing (the button spins)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Syncing",
    apply(store) {
      store.connections[1].status = "syncing";
    },
  },
  {
    id: "sync-one-error",
    label: "One connection failed (red dot)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Error",
    apply(store) {
      Object.assign(store.connections[1], { status: "error", lastError: "sync interrupted (the server restarted)" });
    },
  },
  {
    id: "sync-one-warning",
    label: "Bank data outdated (amber dot)",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "Warning",
    apply(store) {
      store.connections[0].health = health({ lastUpdatedOn: staleDay(5) });
    },
  },
  {
    id: "sync-none",
    label: "No connections",
    pieces: ["Sync", "Settings · Connections"],
    group: "Connections",
    option: "None",
    apply(store) {
      emptyHousehold(store);
      store.connections = [];
    },
  },
];
