import { BANK, CHECKING, ESE, HISTORY_DAYS, PEA, cat } from "../data/base.ts";
import { lotRow, newestFirst } from "../data/rows.ts";
import { TODAY, daysAgo, isoDay } from "../data/util.ts";
import type { Store } from "../store.ts";
import { queueForReview, summary } from "../views/budget.ts";
import { addAccount, addRow, queue, security } from "./helpers.ts";
import type { MockState } from "./pieces.ts";

/** This month's net (income − expenses), as the overview shows it. */
function monthNet(store: Store): number {
  const month = isoDay(TODAY).slice(0, 7);
  return Number(summary(store, new URLSearchParams({ month })).figures.net.amount);
}

/** One more expense today, filed under housing. */
function addExpense(store: Store, description: string, amount: number) {
  addRow(store, "housing", { t: TODAY, type: "card", accountId: CHECKING, description, amount: -amount });
}

export const overview: MockState[] = [
  {
    id: "budget-to-review",
    label: "The AI filed 9 transactions it isn't sure of (to review)",
    pieces: ["Budget transactions", "Budget overview", "Budget review"],
    apply(store) {
      const from = daysAgo(30);
      store.txns
        .filter((x) => x.source === "cash" && x.t >= from && x.categorySource === "ai" && !x.isTransfer)
        .slice(0, 9)
        .forEach((x, i) => queueForReview(x, x.categoryId, (0.45 + (i % 4) * 0.05).toFixed(2)));
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
      addExpense(store, "FACTURE GARAGE REPARATION", Math.max(0, monthNet(store)) + 850);
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
      if (net > 0) addExpense(store, "VIREMENT LOYER", net);
    },
  },
];

export const review: MockState[] = [
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
      store.txns.filter((x) => x.source === "cash" && !x.isTransfer).slice(0, 260)
        .forEach((x, i) => queueForReview(x, x.categoryId, x.categoryId ? (0.45 + (i % 5) * 0.04).toFixed(2) : null));
    },
  },
];

export const transactions: MockState[] = [
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
      const accountId = addAccount(store, BANK, 0, { name: "Wise USD", color: "#9da3fa", typeKey: "checking", currency: "USD" });
      const rows: [number, string, number, string][] = [
        [2, "CB WHOLE FOODS NYC", -84.37, "groceries"],
        [3, "CB UBER *TRIP", -23.9, "transport"],
        [4, "CB STARBUCKS 1234", -6.45, "restaurants"],
        [5, "VIR WISE CONVERSION EUR USD", 500, "internal"],
      ];
      for (const [days, description, amount, categoryKey] of rows) {
        addRow(store, categoryKey, { t: daysAgo(days), type: amount < 0 ? "card" : "transfer", accountId, description, amount });
      }
    },
  },
  {
    id: "transactions-orphan",
    label: "A transfer whose other half was filed elsewhere (unpaired)",
    pieces: ["Budget transactions"],
    apply(store) {
      const out = store.txns.find((x) => x.isTransfer && x.description === "VIR VERS LIVRET A")!;
      const back = store.txns.find((x) => x.isTransfer && x.description === "VIR DEPUIS COMPTE COURANT" && x.t > out.t)!;
      Object.assign(out, { isTransfer: false, categoryId: cat(store.categories, "shopping"), categorySource: "user" });
      Object.assign(back, { isTransfer: false, isOrphanTransfer: true });
    },
  },
  {
    id: "transactions-long",
    label: "A long description and 6 tags on one row",
    pieces: ["Budget transactions"],
    apply(store) {
      store.tags.push(
        { id: store.ids.next("tag"), name: "Work expenses", color: "#cb93e2" },
        { id: store.ids.next("tag"), name: "Shared with Alex", color: "#5fcf9e" },
        { id: store.ids.next("tag"), name: "Tax-deductible", color: "#f0b952" },
      );
      addRow(store, "sport", {
        t: daysAgo(1), type: "card", accountId: CHECKING, amount: -185,
        description: "PRLV SEPA ASSOCIATION SPORTIVE ET CULTURELLE DU QUARTIER SAINT-AMBROISE COTISATION ANNUELLE 2026",
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
      store.txns.push(lotRow(store.ids.next("txn"), { side: "sell", t: daysAgo(2), accountId: PEA, holdingId: ESE, quantity: 5, unitPrice: price, fee: 1.99 }));
      store.txns.sort(newestFirst);
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
  {
    id: "fx-budget",
    label: "Budget: a transaction has no rate",
    pieces: ["Budget transactions", "Budget overview", "Exchange rates"],
    apply(store) {
      store.fx.budget = true;
    },
  },
];
