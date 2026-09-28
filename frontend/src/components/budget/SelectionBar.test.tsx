import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SelectionBar } from "./SelectionBar";
import { BudgetProvider } from "./BudgetProvider";
import { useBudget } from "./budgetContext";

function Controls() {
  const b = useBudget();
  return (
    <>
      <button onClick={() => b.toggleRow("a")}>pick-a</button>
      <button onClick={() => b.selectAllShown()}>pick-all</button>
    </>
  );
}

function renderBar(props: Partial<Parameters<typeof SelectionBar>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const handlers = {
    onAssignCategory: vi.fn(),
    onAddTags: vi.fn(),
    onMarkChecked: vi.fn(),
  };
  render(
    <BudgetProvider>
      <Controls />
      <SelectionBar matching={57} total="-21.48" showChecked={false} busy={false} {...handlers} {...props} />
    </BudgetProvider>,
    { wrapper: Wrapper },
  );
  return handlers;
}

describe("SelectionBar", () => {
  it("stays hidden while nothing is selected", () => {
    renderBar();
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("counts hand-picked rows", () => {
    renderBar();
    fireEvent.click(screen.getByText("pick-a"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1");
  });

  it("counts the server's matching total for select-all-shown", () => {
    renderBar();
    fireEvent.click(screen.getByText("pick-all"));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("57");
  });

  // The sum itself is computed by the caller (`TransactionsMode`); this bar
  // only renders whatever `total` it is passed.
  it("renders the total it is passed", () => {
    renderBar({ total: "-21.48" });
    fireEvent.click(screen.getByText("pick-a"));
    expect(screen.getByTestId("selection-total")).toHaveTextContent("21,48");
  });

  it("shows mark-checked only when the preference is on", () => {
    renderBar();
    fireEvent.click(screen.getByText("pick-a"));
    expect(screen.queryByTestId("bulk-checked")).toBeNull();

    renderBar({ showChecked: true });
    fireEvent.click(screen.getAllByText("pick-a")[1]);
    expect(screen.getAllByTestId("bulk-checked")[0]).toBeVisible();
  });

  it("clears the selection", () => {
    renderBar();
    fireEvent.click(screen.getByText("pick-a"));
    fireEvent.click(screen.getByTestId("selection-clear"));
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });

  describe("pending tags", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const body = String(url).includes("/budget/tags")
            ? [
                { id: "t1", name: "holiday", color: "#f0b952", txCount: 2 },
                { id: "t2", name: "work", color: "#5b9bf0", txCount: 5 },
              ]
            : [];
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }),
      );
    });

    it("discards the pending tags when the chooser is dismissed without saving", async () => {
      const handlers = renderBar();
      fireEvent.click(screen.getByText("pick-a"));

      fireEvent.click(screen.getByLabelText("Add tags"));
      fireEvent.click(await screen.findByTestId("chooser-option-t1"));
      fireEvent.click(await screen.findByTestId("chooser-option-t2"));
      // The chooser is a popover, not a modal: Escape is how it closes.
      fireEvent.keyDown(document, { key: "Escape" });

      expect(handlers.onAddTags).not.toHaveBeenCalled();
    });

    it("flushes accumulated tags once on save, and never leaks into the next session", async () => {
      const handlers = renderBar();
      fireEvent.click(screen.getByText("pick-a"));

      // First session: open, toggle both tags, save — a single flush with both ids.
      fireEvent.click(screen.getByLabelText("Add tags"));
      fireEvent.click(await screen.findByTestId("chooser-option-t1"));
      fireEvent.click(await screen.findByTestId("chooser-option-t2"));
      fireEvent.click(screen.getByTestId("chooser-save"));

      expect(handlers.onAddTags).toHaveBeenCalledTimes(1);
      expect(handlers.onAddTags).toHaveBeenCalledWith(["t1", "t2"]);

      // Second session: reopen and save is unavailable with nothing pending,
      // so the first session's set cannot be re-sent.
      fireEvent.click(screen.getByLabelText("Add tags"));
      await screen.findByTestId("chooser-option-t1");
      expect(screen.getByTestId("chooser-save")).toBeDisabled();
      fireEvent.keyDown(document, { key: "Escape" });

      expect(handlers.onAddTags).toHaveBeenCalledTimes(1);
    });

  });
});
