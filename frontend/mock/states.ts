// States for the review panel, added as each piece of the UI is reviewed.
// Each one tweaks the base data (or forces an answer); several can be on at
// once, unless they share a `group`, and Reset re-applies the active ones on
// fresh data. The panel lists the
// states of the piece under review (`FOCUS`).

import { BANK, BROKER, CHECKING, CW8, ESE, HISTORY_DAYS, PEA, SP500, WORLD, closes } from "./data/base";
import { TODAY, daysAgo, id } from "./data/util";
import type { Store } from "./store";
import { lotsOf } from "./views/portfolio";

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

/** The piece under review: the panel lists its states. */
export const FOCUS = "Record purchases";

export const STATES: MockState[] = [
  // ── Distribution ──
  {
    id: "distribution-overdraft",
    label: "Checking account overdrawn (negative balance)",
    pieces: ["Distribution"],
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
    pieces: ["Distribution"],
    apply(store) {
      extraAccount(store, 1, "LDDS", "savings", "#f0b952", 0);
    },
  },
  {
    id: "distribution-many",
    label: "12 accounts, long names, tiny ones",
    pieces: ["Distribution"],
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
    pieces: ["Distribution", "Net worth chart", "Holdings"],
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
    pieces: ["Record purchases", "Holdings"],
    apply(store) {
      const sec = addDcam(store);
      security(store, sec).reportedQty = lotShares(store, sec);
      store.manualLots[sec] = [];
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
  // ── Holdings ──
  {
    id: "holdings-many",
    label: "Life insurance with 7 funds: long names, fractions",
    pieces: ["Holdings"],
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
    pieces: ["Net worth chart"],
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
    pieces: ["Exchange rates", "Net worth chart", "Distribution", "Holdings", "Asset window"],
    apply(store) {
      store.fx.missing = [ESE, CW8];
    },
  },
  {
    id: "fx-budget",
    label: "Budget: a transaction has no rate",
    pieces: ["Exchange rates"],
    apply(store) {
      store.fx.budget = true;
    },
  },
  {
    id: "fx-rate-down",
    label: "Currency change can't get its rate (Settings)",
    pieces: ["Exchange rates"],
    apply(store) {
      store.fx.rateDown = true;
    },
  },
  {
    id: "dashboard-lots-short",
    label: "Lots explain 3 shares fewer than CW8 holds",
    pieces: ["Holdings", "Asset window", "Record purchases"],
    apply(store) {
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
    },
  },
  {
    id: "dashboard-lots-excess",
    label: "Lots explain 2 shares more than ESE holds",
    pieces: ["Holdings", "Asset window", "Record purchases"],
    apply(store) {
      security(store, ESE).reportedQty = lotShares(store, ESE) - 2;
    },
  },
  {
    id: "dashboard-private",
    label: "Private mode on",
    pieces: ["Net worth chart", "Distribution", "Holdings", "Asset window", "Record purchases"],
    apply(store) {
      store.user.prefs.privateMode = true;
    },
  },
  {
    id: "dashboard-empty",
    label: "New user: nothing connected yet",
    pieces: ["Net worth chart", "Distribution", "Holdings"],
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
    pieces: ["Net worth chart", "Distribution", "Holdings"],
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
    pieces: ["Net worth chart", "Distribution", "Holdings"],
    group: "Data",
    option: "Empty",
    apply(store) {
      emptyHousehold(store);
      store.connections = [store.connections[0]];
    },
  },
];
