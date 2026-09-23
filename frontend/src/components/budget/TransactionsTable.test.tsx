import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TransactionsTable } from "./TransactionsTable";
import type { Transaction } from "../../api/types";

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t1", t: Date.UTC(2026, 8, 12, 12), type: "withdrawal", description: "ALDI",
    amount: "-12.40", amountReporting: "-12.40", currency: "EUR", accountId: "a", accountName: "Current",
    accountColor: null, source: "cash", ticker: null, quantity: null, unitPrice: null,
    fee: null, categoryId: null, categoryName: null, categoryDefaultKey: null,
    categoryColor: null, categoryIcon: null, categoryKind: null, categorySource: null,
    categoryConfidence: null, needsReview: false, checked: false, isTransfer: false, isOrphanTransfer: false,
    merchantName: null, merchantDomain: null, merchantLogoUrl: null,
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

  it("does not crash or mislead when counts are undefined generally", () => {
    render(<TransactionsTable {...BASE} rows={[tx({})]} counts={undefined} />);
    expect(screen.getByRole("table")).toBeVisible();
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
