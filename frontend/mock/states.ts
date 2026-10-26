// Per-screen states for the review panel, added as each screen is reviewed.
// Each one tweaks the base data (or forces an answer) for one route; several
// can be on at once, and Reset re-applies the active ones on fresh data.

import { CHECKING, CW8, ESE, HISTORY_DAYS } from "./data/base";
import { daysAgo } from "./data/util";
import type { Store } from "./store";
import { lotsOf } from "./views/portfolio";

export type MockState = {
  id: string;
  label: string;
  /** The app path the state belongs to; the panel lists it there. */
  route: string;
  apply(store: Store): void;
};

/** Shares the recorded lots explain. */
function lotShares(store: Store, holdingId: string): number {
  return lotsOf(store, holdingId).reduce((q, l) => q + (l.side === "sell" ? -1 : 1) * Number(l.qty), 0);
}

function security(store: Store, id: string) {
  return store.securities.find((s) => s.id === id)!;
}

export const STATES: MockState[] = [
  // ── Dashboard ──
  {
    id: "dashboard-loss",
    label: "Net worth down: markets fell, a big payment left",
    route: "/",
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
    route: "/",
    apply(store) {
      store.fx.missing = [ESE];
    },
  },
  {
    id: "dashboard-reporting-fx",
    label: "No rate into the chosen currency",
    route: "/",
    apply(store) {
      store.fx.reportingMissing = true;
    },
  },
  {
    id: "dashboard-lots-short",
    label: "Lots explain 3 shares fewer than CW8 holds",
    route: "/",
    apply(store) {
      security(store, CW8).reportedQty = lotShares(store, CW8) + 3;
    },
  },
  {
    id: "dashboard-lots-excess",
    label: "Lots explain 2 shares more than ESE holds",
    route: "/",
    apply(store) {
      security(store, ESE).reportedQty = lotShares(store, ESE) - 2;
    },
  },
  {
    id: "dashboard-private",
    label: "Private mode on",
    route: "/",
    apply(store) {
      store.user.prefs.privateMode = true;
    },
  },
  {
    id: "dashboard-empty",
    label: "New user: nothing connected yet",
    route: "/",
    apply(store) {
      store.connections = [];
      store.accounts = [];
      store.securities = [];
      store.txns = [];
      store.openingCash = {};
    },
  },
];
