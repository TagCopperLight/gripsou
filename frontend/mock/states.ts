// States for the review panel, added as each piece of the UI is reviewed.
// Each one tweaks the base data (or forces an answer); several can be on at
// once, unless they share a `group`, and Reset re-applies the active ones on
// fresh data. The panel lists the
// states of the piece under review (`FOCUS`).

import { BANK, CHECKING, CW8, ESE, HISTORY_DAYS } from "./data/base";
import { daysAgo, id } from "./data/util";
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

/** The piece under review: the panel lists its states. */
export const FOCUS = "Distribution";

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
    pieces: ["Exchange rates", "Net worth chart", "Distribution", "Holdings"],
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
    pieces: ["Holdings"],
    apply(store) {
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
    },
  },
  {
    id: "dashboard-lots-excess",
    label: "Lots explain 2 shares more than ESE holds",
    pieces: ["Holdings"],
    apply(store) {
      security(store, ESE).reportedQty = lotShares(store, ESE) - 2;
    },
  },
  {
    id: "dashboard-private",
    label: "Private mode on",
    pieces: ["Net worth chart", "Distribution"],
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
