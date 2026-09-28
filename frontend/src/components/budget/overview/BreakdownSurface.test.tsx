import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { BreakdownSurface } from "./BreakdownSurface";
import type { BreakdownRow } from "../../../api/overview";

function cat(id: string, name: string, color = "#8fd05f") {
  return {
    kind: "category" as const,
    category: { id, name, defaultKey: null, color, icon: null },
  };
}

const rows: BreakdownRow[] = [
  { slice: cat("c1", "Rent"), amount: "1200.00", txnCount: 1, avg12: "1150.00" },
  { slice: cat("c2", "Groceries"), amount: "420.00", txnCount: 31, avg12: "460.00" },
  { slice: { kind: "uncategorised" }, amount: "180.00", txnCount: 9 },
  { slice: { kind: "other" }, amount: "140.00", txnCount: 12 },
];

function renderTable(onOpen = vi.fn()) {
  render(<BreakdownSurface rows={rows} expensesTotal="1940.00" onOpen={onOpen} />);
  return onOpen;
}

const rowIds = () =>
  screen.getAllByTestId(/^breakdown-row-/).map((el) => el.getAttribute("data-testid"));

describe("BreakdownSurface", () => {
  it("lists every row largest first by default", () => {
    renderTable();
    expect(rowIds()).toEqual([
      "breakdown-row-cat:c1",
      "breakdown-row-cat:c2",
      "breakdown-row-uncategorised",
      "breakdown-row-other",
    ]);
  });

  it("computes share against the period's expenses total", () => {
    renderTable();
    // 1200 / 1940 = 61,9 %
    expect(within(screen.getByTestId("breakdown-row-cat:c1")).getByTestId("share")).toHaveTextContent("61");
  });

  it("keeps Other last even when sorted ascending", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("sort-amount"));
    const ids = rowIds();
    expect(ids.at(-1)).toBe("breakdown-row-other");
    expect(ids[0]).toBe("breakdown-row-uncategorised");
  });

  it("sorts by category name", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("sort-category"));
    expect(rowIds()[0]).toBe("breakdown-row-cat:c2"); // Groceries
  });

  it("shows each row's transaction count and sorts by it", () => {
    renderTable();
    expect(within(screen.getByTestId("breakdown-row-cat:c2")).getByTestId("txnCount")).toHaveTextContent("31");
    fireEvent.click(screen.getByTestId("sort-txnCount"));
    expect(rowIds()).toEqual([
      "breakdown-row-cat:c2",
      "breakdown-row-uncategorised",
      "breakdown-row-cat:c1",
      "breakdown-row-other",
    ]);
  });

  it("leaves the vs-12-month cell empty where the server sent no baseline", () => {
    renderTable();
    expect(
      within(screen.getByTestId("breakdown-row-other")).getByTestId("avg12"),
    ).toHaveTextContent("—");
  });

  it("deep-links a category row by its id", () => {
    const onOpen = renderTable();
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    expect(onOpen).toHaveBeenCalledWith(rows[0].slice);
  });

  it("deep-links the uncategorised row too", () => {
    const onOpen = renderTable();
    fireEvent.click(screen.getByTestId("breakdown-row-uncategorised"));
    expect(onOpen).toHaveBeenCalledWith({ kind: "uncategorised" });
  });

  it("does not link the Other row — its members are not in the payload", () => {
    const onOpen = renderTable();
    fireEvent.click(screen.getByTestId("breakdown-row-other"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId("breakdown-row-other")).queryByTestId("row-caret"),
    ).toBeNull();
  });

  it("opens a row from its caret button, reachable by keyboard, without double-firing the row's own click handler", () => {
    const onOpen = renderTable();
    fireEvent.click(
      within(screen.getByTestId("breakdown-row-cat:c1")).getByRole("button", {
        name: "Open these transactions",
      }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(rows[0].slice);
  });

  it("sorts only by category, amount and transactions", () => {
    renderTable();
    expect(screen.getByTestId("sort-category")).toBeInTheDocument();
    expect(screen.getByTestId("sort-amount")).toBeInTheDocument();
    expect(screen.getByTestId("sort-txnCount")).toBeInTheDocument();
    expect(screen.queryByTestId("sort-share")).toBeNull();
    expect(screen.queryByTestId("sort-avg12")).toBeNull();
  });

  it("compares with the 12-month average by the same rules as the figures above", () => {
    render(
      <BreakdownSurface
        rows={[
          { slice: cat("c1", "Rent"), amount: "1200.00", txnCount: 1, avg12: "1200.00" },
          { slice: cat("c2", "Gifts"), amount: "80.00", txnCount: 2, avg12: "0.00" },
        ]}
        expensesTotal="1280.00"
        onOpen={vi.fn()}
      />,
    );
    // Unchanged is neutral, not "good".
    const same = within(screen.getByTestId("breakdown-row-cat:c1")).getByTestId("avg12");
    expect(same.querySelector("[data-tone]")).toHaveAttribute("data-tone", "flat");
    // Against a zero average the change is an amount, not a dash.
    const fromZero = within(screen.getByTestId("breakdown-row-cat:c2")).getByTestId("avg12");
    expect(fromZero).toHaveTextContent("+80,00");
    expect(fromZero.querySelector("[data-tone]")).toHaveAttribute("data-tone", "bad");
  });
});
