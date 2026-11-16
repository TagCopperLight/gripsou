import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { BudgetProvider } from "./BudgetProvider";
import { useBudget } from "./budgetContext";

function Probe() {
  const b = useBudget();
  return (
    <div>
      <span data-testid="search">{b.filters.search}</span>
      <span data-testid="mode">{b.selection.mode}</span>
      <span data-testid="count">
        {b.selection.mode === "ids" ? b.selection.ids.size : "all"}
      </span>
      <span data-testid="any">{String(b.anySelected)}</span>
      <button onClick={() => b.toggleRow("a")}>toggle-a</button>
      <button onClick={() => b.toggleRow("b")}>toggle-b</button>
      <button onClick={() => b.selectAllShown()}>all</button>
      <button onClick={() => b.clearSelection()}>clear</button>
      <button onClick={() => b.patchFilters({ search: "aldi" })}>filter</button>
      <button
        onClick={() => {
          b.patchFilters({ search: "aldi" });
          b.patchFilters({ accountId: "acc-1" });
        }}
      >
        double-patch
      </button>
      <span data-testid="accountId">{b.filters.accountId}</span>
      <span data-testid="ids">
        {b.selection.mode === "ids" ? [...b.selection.ids].join(",") : "n/a"}
      </span>
      <span data-testid="categoryIds">{b.filters.categoryIds.join(",")}</span>
      <button
        onClick={() => {
          b.patchFilters((prev) => ({ categoryIds: [...prev.categoryIds, "cat-1"] }));
          b.patchFilters((prev) => ({ categoryIds: [...prev.categoryIds, "cat-2"] }));
        }}
      >
        double-updater-patch
      </button>
    </div>
  );
}

function renderProbe() {
  render(
    <BudgetProvider>
      <Probe />
    </BudgetProvider>,
  );
}

describe("BudgetProvider", () => {
  it("starts unfiltered with nothing selected", () => {
    renderProbe();
    expect(screen.getByTestId("search")).toHaveTextContent("");
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("any")).toHaveTextContent("false");
  });

  it("toggles rows on and off", () => {
    renderProbe();
    fireEvent.click(screen.getByText("toggle-a"));
    fireEvent.click(screen.getByText("toggle-b"));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    fireEvent.click(screen.getByText("toggle-a"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("select-all-shown is a mode, not an expanded id list", () => {
    renderProbe();
    fireEvent.click(screen.getByText("all"));
    expect(screen.getByTestId("mode")).toHaveTextContent("allShown");
    expect(screen.getByTestId("any")).toHaveTextContent("true");
  });

  it("clears the selection whenever a filter changes", () => {
    renderProbe();
    fireEvent.click(screen.getByText("all"));
    fireEvent.click(screen.getByText("filter"));
    expect(screen.getByTestId("search")).toHaveTextContent("aldi");
    expect(screen.getByTestId("mode")).toHaveTextContent("ids");
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("clears the selection", () => {
    renderProbe();
    fireEvent.click(screen.getByText("toggle-a"));
    fireEvent.click(screen.getByText("toggle-b"));
    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("toggling a row out of allShown starts a fresh explicit selection", () => {
    renderProbe();
    fireEvent.click(screen.getByText("all"));
    expect(screen.getByTestId("mode")).toHaveTextContent("allShown");
    fireEvent.click(screen.getByText("toggle-a"));
    expect(screen.getByTestId("mode")).toHaveTextContent("ids");
    expect(screen.getByTestId("ids")).toHaveTextContent("a");
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("two patchFilters calls in the same tick both survive", () => {
    renderProbe();
    fireEvent.click(screen.getByText("double-patch"));
    expect(screen.getByTestId("search")).toHaveTextContent("aldi");
    expect(screen.getByTestId("accountId")).toHaveTextContent("acc-1");
  });

  // With the plain-object form both calls read the same pre-batch `filters.categoryIds`, so the second discards the first.
  it("two updater-form patchFilters calls in the same tick both survive", () => {
    renderProbe();
    fireEvent.click(screen.getByText("double-updater-patch"));
    expect(screen.getByTestId("categoryIds")).toHaveTextContent("cat-1,cat-2");
  });
});

describe("period", () => {
  function PeriodProbe() {
    const { period, setPeriod } = useBudget();
    return (
      <>
        <span data-testid="period">{JSON.stringify(period)}</span>
        <button onClick={() => setPeriod({ mode: "month", month: "2024-03" })}>to-march</button>
        <button
          onClick={() => setPeriod({ mode: "range", from: "2024-01-01", to: "2024-03-31" })}
        >
          to-range
        </button>
      </>
    );
  }

  it("starts with no period picked, leaving the Overview to open on the latest data", () => {
    render(
      <BudgetProvider>
        <PeriodProbe />
      </BudgetProvider>,
    );
    expect(screen.getByTestId("period")).toHaveTextContent("null");
  });

  it("leaves the selection alone, since a period is not a transactions filter", () => {
    // The period does not touch the transactions query, so it must not clear the selection.
    function Probe() {
      const { setPeriod, toggleRow, anySelected } = useBudget();
      return (
        <>
          <button onClick={() => toggleRow("a")}>pick</button>
          <button onClick={() => setPeriod({ mode: "month", month: "2024-03" })}>move</button>
          <span data-testid="any">{String(anySelected)}</span>
        </>
      );
    }
    render(
      <BudgetProvider>
        <Probe />
      </BudgetProvider>,
    );
    fireEvent.click(screen.getByText("pick"));
    fireEvent.click(screen.getByText("move"));
    expect(screen.getByTestId("any")).toHaveTextContent("true");
  });
});
