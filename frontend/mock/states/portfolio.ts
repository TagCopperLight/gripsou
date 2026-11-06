import ACCOUNT_PALETTE from "../../../shared/account-palette.json" with { type: "json" };
import { BANK, BROKER, CHECKING, CW8, ESE, HISTORY_DAYS, PEA, SP500, WORLD, closes, dayIndex } from "../data/base.ts";
import { daysAgo, isoDay } from "../data/util.ts";
import type { Store } from "../store.ts";
import { lotsOf } from "../views/portfolio.ts";
import { addAccount, addRow, emptyHousehold, lotShares, nothingConnected, security } from "./helpers.ts";
import type { MockState } from "./pieces.ts";

/** DCAM.PA in the PEA, as production stores it; returns its id. */
function addDcam(store: Store): string {
  // Public market data as production stores it: the Yahoo ticker, the
  // provider's name, a price near 6,30 €, prices only from the fund's
  // launch (4 March 2025), and Boursorama's composition as of October
  // 2026. Quantities and dates of the purchases are made up.
  const sec = store.ids.next("security");
  const launch = dayIndex(Date.UTC(2025, 2, 4));
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
  for (let i = launch + 30; i < HISTORY_DAYS; i += 61) {
    store.manualLots[sec].push({
      id: store.ids.next("lot"), t: daysAgo(HISTORY_DAYS - 1 - i), side: "buy", qty: "80", price: c[i].toFixed(3), fee: "0", manual: true,
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

export const distribution: MockState[] = [
  {
    id: "distribution-overdraft",
    label: "Checking account overdrawn (negative balance)",
    pieces: ["Distribution", "Accounts chart", "Accounts list"],
    apply(store) {
      addRow(store, null, { t: daysAgo(2), type: "order", accountId: CHECKING, description: "PRLV SEPA LOYER", amount: -4500 });
    },
  },
  {
    id: "distribution-empty-account",
    label: "An account at 0 € (emptied savings book)",
    pieces: ["Distribution", "Accounts list"],
    apply(store) {
      addAccount(store, BANK, 0, { name: "LDDS", typeKey: "savings", color: ACCOUNT_PALETTE[3] });
    },
  },
  {
    id: "distribution-many",
    label: "12 accounts, long names, tiny ones",
    pieces: ["Distribution", "Accounts chart", "Accounts list", "Edit account"],
    apply(store) {
      const more: [string, string, string, number][] = [
        ["Compte joint Camille et Alex", "checking", ACCOUNT_PALETTE[4], 1840],
        ["Livret Développement Durable et Solidaire", "savings", ACCOUNT_PALETTE[5], 4200],
        ["Livret Jeune", "savings", ACCOUNT_PALETTE[6], 1600],
        ["PEL", "savings", ACCOUNT_PALETTE[7], 7300],
        ["Compte à terme 2027", "savings", ACCOUNT_PALETTE[8], 3000],
        ["Assurance vie Linxea Spirit 2", "brokerage", ACCOUNT_PALETTE[9], 12500],
        ["CEL", "savings", ACCOUNT_PALETTE[0], 310],
        ["Compte courant pro", "checking", ACCOUNT_PALETTE[1], 42],
        ["Cagnotte vacances", "savings", ACCOUNT_PALETTE[2], 12],
      ];
      for (const [name, typeKey, color, cash] of more) addAccount(store, BANK, cash, { name, typeKey, color });
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
      addAccount(store, BANK, 0, { name: "Compte courant", typeKey: "checking", color: "#60b4f5" });
      addAccount(store, BANK, 0, { name: "Livret A", typeKey: "savings", color: "#34d399" });
    },
  },
];

export const assetWindow: MockState[] = [
  {
    id: "asset-dcam",
    label: "DCAM.PA in the PEA (launched March 2025, ~6 € a share)",
    pieces: ["Asset window", "Holdings"],
    apply(store) {
      addDcam(store);
    },
  },
];

export const recordPurchases: MockState[] = [
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
        date: isoDay(daysAgo(ago)),
        quantity: "1",
        unitPrice: c[HISTORY_DAYS - 1 - ago].toFixed(2),
        fee: "1.99",
      }));
    },
  },
  {
    id: "asset-sold",
    label: "CW8: 2 shares sold last month",
    pieces: ["Asset window", "Record purchases", "Investments"],
    apply(store) {
      const c = security(store, CW8).closes;
      store.manualLots[CW8] = [
        ...(store.manualLots[CW8] ?? []),
        { id: store.ids.next("lot"), t: daysAgo(25), side: "sell", qty: "2", price: c[HISTORY_DAYS - 26].toFixed(2), fee: "1.99", manual: true },
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
];

export const investments: MockState[] = [
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
];

export const holdings: MockState[] = [
  {
    id: "holdings-many",
    label: "Life insurance with 7 funds: long names, fractions",
    pieces: ["Investments", "Holdings"],
    apply(store) {
      const account = addAccount(store, BROKER, 1250, { name: "Assurance vie Linxea Spirit 2", color: ACCOUNT_PALETTE[3], typeKey: "life_insurance" });
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
        const sec = store.ids.next("security");
        const c = closes(40 + i, last, 0.0002, 0.012);
        store.securities.push({ id: sec, accountId: account, ticker, name, closes: c, composition: i % 2 ? SP500 : WORLD });
        store.manualLots[sec] = [
          { id: store.ids.next("lot"), t: daysAgo(300), side: "buy", qty: String(qty), price: c[HISTORY_DAYS - 301].toFixed(2), fee: "0", manual: true },
        ];
      });
    },
  },
];

export const dashboard: MockState[] = [
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
      addRow(store, null, { t: daysAgo(20), type: "transfer", accountId: CHECKING, description: "VIR SEPA NOTAIRE ACOMPTE", amount: -9000 });
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
    id: "dashboard-reporting-rate-late",
    label: "The reader's currency has a rate only for the last 15 days",
    pieces: ["Net worth chart", "Accounts chart"],
    group: "Reporting rate",
    option: "Last 15 days",
    apply(store) {
      store.fx.reportingFrom = HISTORY_DAYS - 15;
    },
  },
  {
    id: "dashboard-reporting-rate-none",
    label: "The reader's currency has no rate at all",
    pieces: ["Net worth chart", "Accounts chart", "Accounts list", "Settings · Connections"],
    group: "Reporting rate",
    option: "None",
    apply(store) {
      store.fx.reportingFrom = HISTORY_DAYS;
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
    pieces: ["Settings · General", "Budget transactions", "Budget review", "Investments", "Net worth chart", "Distribution", "Holdings", "Asset window", "Record purchases", "Accounts chart", "Accounts list", "Edit account"],
    apply(store) {
      store.user.prefs.privateMode = true;
    },
  },
  {
    id: "dashboard-empty",
    label: "New user: nothing connected yet",
    pieces: ["Investments", "Net worth chart", "Distribution", "Holdings", "Accounts chart", "Sync", "Settings · Connections"],
    group: "Data",
    option: "New",
    apply(store) {
      nothingConnected(store);
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
      store.connections = store.connections.filter((c) => c.id === BANK).map((c) => ({ ...c, status: "syncing" as const, lastSyncAt: null }));
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
      store.connections = store.connections.filter((c) => c.id === BANK);
    },
  },
];

export const editAccount: MockState[] = [
  {
    id: "edit-account-save-fails",
    label: "Saving an account fails",
    pieces: ["Edit account"],
    apply(store) {
      store.faults.push({ method: "PATCH", path: "/accounts/:id", mode: "error" });
    },
  },
];

