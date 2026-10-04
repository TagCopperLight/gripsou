import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TransactionsTable } from "./TransactionsTable";
import type { Transaction } from "../../api/types";

// Counts component renders: the table and every row call `useTranslation`
// once per render. (Counting a child such as the avatar would not do: the
// React Compiler caches a row's child elements, so a child can skip while
// the row itself still runs.)
const translations = vi.hoisted(() => ({ calls: 0 }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: (...args: Parameters<typeof actual.useTranslation>) => {
      translations.calls++;
      return actual.useTranslation(...args);
    },
  };
});

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t1", t: Date.UTC(2026, 8, 12, 12), type: "withdrawal", description: "ALDI",
    amount: "-12.40", amountReporting: "-12.40", fxMissing: false, currency: "EUR", accountId: "a", accountName: "Current",
    accountColor: null, source: "cash", ticker: null, logo: null, quantity: null, unitPrice: null,
    fee: null, categoryId: null, categoryName: null, categoryDefaultKey: null,
    categoryColor: null, categoryIcon: null, categoryKind: null, categorySource: null,
    categoryConfidence: null, needsReview: false, checked: false, isTransfer: false, isOrphanTransfer: false,
    tags: [], ...over,
  };
}

/** jsdom has no IntersectionObserver; the table must still page, which is what
 *  the button fallback is for — and it is what these tests drive. */
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const BASE = {
  rows: [tx({})],
  showChecked: false,
  counts: { matching: 1, total: 400, uncategorized: 300, matchingTotal: "0", fxMissing: false, reportingFxMissing: false },
  filtered: false,
  loading: false,
  error: false,
  onRetry: vi.fn(),
  hasNextPage: false,
  fetchingNextPage: false,
  onLoadMore: vi.fn(),
  onClearFilters: vi.fn(),
  isSelected: () => false,
  anySelected: false,
  onToggleSelect: vi.fn(),
  onOpenCategory: vi.fn(),
  onOpenTags: vi.fn(),
  onToggleChecked: vi.fn(),
};

describe("TransactionsTable", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", NoopObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders six columns, and seven with the checked preference on", () => {
    const { rerender } = render(<TransactionsTable {...BASE} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    rerender(<TransactionsTable {...BASE} showChecked />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });

  it("tells the first-run empty state from the no-match one", () => {
    const { rerender } = render(
      <TransactionsTable
        {...BASE}
        rows={[]}
        counts={{ matching: 0, total: 0, uncategorized: 0, matchingTotal: "0", fxMissing: false, reportingFxMissing: false }}
      />,
    );
    expect(screen.getByTestId("empty-nothing")).toBeVisible();

    rerender(
      <TransactionsTable
        {...BASE}
        rows={[]}
        filtered
        counts={{ matching: 0, total: 400, uncategorized: 300, matchingTotal: "0", fxMissing: false, reportingFxMissing: false }}
      />,
    );
    expect(screen.getByTestId("empty-no-match")).toBeVisible();
    fireEvent.click(screen.getByTestId("empty-clear-filters"));
    expect(BASE.onClearFilters).toHaveBeenCalled();
  });

  it("pages when the fallback control is used", () => {
    render(<TransactionsTable {...BASE} hasNextPage />);
    fireEvent.click(screen.getByTestId("load-more"));
    expect(BASE.onLoadMore).toHaveBeenCalled();
  });

  it("shows the error state with a retry", () => {
    render(<TransactionsTable {...BASE} rows={[]} error />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("table-state")).toBeVisible();
  });

  it("trusts a known non-zero total over the filter flag (regression: transient empty page while filters are cleared must not read as an empty ledger)", () => {
    render(
      <TransactionsTable
        {...BASE}
        rows={[]}
        filtered={false}
        counts={{ matching: 0, total: 400, uncategorized: 300, matchingTotal: "0", fxMissing: false, reportingFxMissing: false }}
      />,
    );
    expect(screen.getByTestId("empty-no-match")).toBeVisible();
    expect(screen.queryByTestId("empty-nothing")).toBeNull();
  });

  it("falls back to the filter flag while counts are still loading, defaulting to the no-match state", () => {
    render(
      <TransactionsTable
        {...BASE}
        rows={[]}
        filtered
        counts={undefined}
      />,
    );
    expect(screen.getByTestId("empty-no-match")).toBeVisible();
  });

  it("still draws the rows while the counts are loading", () => {
    render(<TransactionsTable {...BASE} rows={[tx({ id: "t1" }), tx({ id: "t2" })]} counts={undefined} />);
    expect(screen.getAllByTestId("tx-row")).toHaveLength(2);
    expect(screen.queryByTestId("empty-nothing")).toBeNull();
    expect(screen.queryByTestId("empty-no-match")).toBeNull();
  });

  it("re-renders only the rows whose own data changed", () => {
    const rows = [tx({ id: "t1" }), tx({ id: "t2" }), tx({ id: "t3" })];
    const { rerender } = render(<TransactionsTable {...BASE} rows={rows} />);

    // What a search keystroke looks like from here: a fresh array holding the
    // same rows, and a fresh-but-equivalent selection test. Only the table
    // itself runs again.
    translations.calls = 0;
    rerender(<TransactionsTable {...BASE} rows={[...rows]} isSelected={() => false} />);
    expect(translations.calls).toBe(1);

    // An optimistic edit replaces one row object: that row runs again, its
    // neighbours do not (table + row + the row's category chip).
    translations.calls = 0;
    const edited = [rows[0], { ...rows[1], checked: true }, rows[2]];
    rerender(<TransactionsTable {...BASE} rows={edited} isSelected={() => false} />);
    expect(translations.calls).toBeLessThanOrEqual(3);
  });

  describe("infinite scroll", () => {
    type Instance = { fire: (hit: boolean) => void; observed: number };
    let instances: Instance[] = [];
    class RecordingObserver {
      private instance: Instance;
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        this.instance = {
          observed: 0,
          fire: (hit) =>
            this.cb([{ isIntersecting: hit } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
        };
        instances.push(this.instance);
      }
      observe() {
        this.instance.observed++;
      }
      unobserve() {}
      disconnect() {}
    }

    beforeEach(() => {
      instances = [];
      vi.stubGlobal("IntersectionObserver", RecordingObserver);
    });

    it("keeps one observer across re-renders, and loads only when the sentinel comes into range", () => {
      const onLoadMore = vi.fn();
      const { rerender } = render(<TransactionsTable {...BASE} hasNextPage onLoadMore={onLoadMore} />);
      for (let i = 0; i < 5; i++) {
        rerender(<TransactionsTable {...BASE} hasNextPage onLoadMore={() => onLoadMore()} isSelected={() => false} />);
      }
      expect(instances).toHaveLength(1);
      expect(onLoadMore).not.toHaveBeenCalled();

      instances[0].fire(true);
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("asks again once a page lands, since the sentinel may still be in range", () => {
      const onLoadMore = vi.fn();
      const { rerender } = render(<TransactionsTable {...BASE} hasNextPage onLoadMore={onLoadMore} />);
      const before = instances[0].observed;
      rerender(<TransactionsTable {...BASE} hasNextPage fetchingNextPage onLoadMore={onLoadMore} />);
      // Nothing while the page is in flight...
      instances[0].fire(true);
      expect(onLoadMore).not.toHaveBeenCalled();
      // ...then a fresh reading once it has landed.
      rerender(<TransactionsTable {...BASE} hasNextPage onLoadMore={onLoadMore} />);
      expect(instances[0].observed).toBeGreaterThan(before);
      instances[0].fire(true);
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  it("wires each row's isSelected/onToggleSelect to its own id, not a neighbour's", () => {
    const onToggleSelect = vi.fn();
    const isSelected = vi.fn((id: string) => id === "t2");
    render(
      <TransactionsTable
        {...BASE}
        rows={[tx({ id: "t1" }), tx({ id: "t2" })]}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
      />,
    );
    expect(isSelected).toHaveBeenCalledWith("t1");
    expect(isSelected).toHaveBeenCalledWith("t2");

    const checkboxes = screen.getAllByTestId("tx-select");
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[0]).not.toBeChecked();

    fireEvent.click(checkboxes[0]);
    expect(onToggleSelect).toHaveBeenCalledWith("t1");
  });
});
