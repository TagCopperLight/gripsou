// States for the review panel, added as each piece of the UI is reviewed.
// Each one tweaks the base data (or forces an answer); several can be on at
// once, unless they share a `group`, and Reset re-applies the active ones on
// fresh data. The panel lists the
// states of the piece under review (`FOCUS`).

import { CHECKING, CW8, ESE, HISTORY_DAYS } from "./data/base";
import { daysAgo } from "./data/util";
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

/** The piece under review: the panel lists its states. */
export const FOCUS = "Net worth chart";

export const STATES: MockState[] = [
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
    label: "An ETF has no exchange rate (⚠, left out)",
    pieces: ["Net worth chart", "Distribution", "Holdings"],
    apply(store) {
      store.fx.missing = [ESE];
    },
  },
  {
    id: "dashboard-reporting-fx",
    label: "No rate into the chosen currency",
    pieces: ["Net worth chart"],
    apply(store) {
      store.fx.reportingMissing = true;
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
    pieces: ["Net worth chart"],
    apply(store) {
      store.user.prefs.privateMode = true;
    },
  },
  {
    id: "dashboard-empty",
    label: "New user: nothing connected yet",
    pieces: ["Net worth chart", "Distribution", "Holdings"],
    group: "Data",
    option: "Empty",
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
    option: "No account",
    apply(store) {
      emptyHousehold(store);
      store.connections = [store.connections[0]];
    },
  },
];
