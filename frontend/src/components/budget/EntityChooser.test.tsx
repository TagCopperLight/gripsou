import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CategoryChooser } from "./CategoryChooser";
import type { BudgetCategory } from "../../api/budget";

function cat(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: "x", name: "X", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 0, ...over,
  };
}

const CATS: BudgetCategory[] = [
  cat({ id: "gro", name: "Groceries", kind: "expense" }),
  cat({ id: "fun", name: "Leisure", kind: "expense" }),
  cat({ id: "sal", name: "Salary", kind: "income", icon: "wallet" }),
  cat({ id: "int", name: "Internal transfer", kind: "internal", systemKey: "internal_transfer" }),
  cat({ id: "old", name: "Archived one", kind: "expense", archived: true }),
];

function renderChooser(props: Partial<Parameters<typeof CategoryChooser>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const onToggle = vi.fn();
  const onPick = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <CategoryChooser
      mode="multi"
      selectedIds={[]}
      onToggle={onToggle}
      onPick={onPick}
      onClose={onClose}
      {...props}
    />,
    { wrapper: Wrapper },
  );
  return { onToggle, onPick, onClose, unmount: result.unmount };
}

describe("CategoryChooser", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(CATS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });

  it("groups the rows under their kind, in kind order, and hides archived ones", async () => {
    renderChooser();
    await screen.findByText("Groceries");
    const groups = screen.getAllByTestId("chooser-group").map((g) => g.textContent);
    expect(groups).toEqual(["EXPENSE", "INCOME", "INTERNAL"]);
    expect(screen.queryByText("Archived one")).toBeNull();
  });

  it("filters the list as the user types", async () => {
    renderChooser();
    await screen.findByText("Groceries");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sal" } });
    expect(screen.getByText("Salary")).toBeVisible();
    expect(screen.queryByText("Groceries")).toBeNull();
  });

  it("in multi mode it checks the line, reports the id and stays open", async () => {
    const { onToggle, onClose } = renderChooser({ selectedIds: ["gro"] });
    const chosen = await screen.findByTestId("chooser-option-gro");
    expect(within(chosen).getByTestId("chooser-check")).toBeVisible();
    fireEvent.click(screen.getByTestId("chooser-option-sal"));
    expect(onToggle).toHaveBeenCalledWith("sal");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("in pick mode it applies and closes, and offers clearing the category", async () => {
    const first = renderChooser({ mode: "pick" });
    fireEvent.click(await screen.findByTestId("chooser-option-sal"));
    expect(first.onPick).toHaveBeenCalledWith("sal");
    expect(first.onClose).toHaveBeenCalled();
    first.unmount();

    const again = renderChooser({ mode: "pick" });
    fireEvent.click(await screen.findByTestId("chooser-option-none"));
    expect(again.onPick).toHaveBeenCalledWith(null);
  });

  it("has no clear-category line in multi mode", async () => {
    renderChooser();
    await screen.findByText("Groceries");
    expect(screen.queryByTestId("chooser-option-none")).toBeNull();
  });

  it("moves through the list with the arrow keys and applies with Enter", async () => {
    const { onToggle } = renderChooser();
    await screen.findByText("Groceries");
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("fun");
  });

  it("reaches the no-category line by keyboard, applying it with Enter", async () => {
    const { onPick, onClose } = renderChooser({ mode: "pick" });
    await screen.findByText("Groceries");
    const list = screen.getByRole("listbox");
    // The "no category" line sits first in the navigable sequence, so Enter
    // with no arrow presses at all should already reach it.
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  describe("allowNone", () => {
    it("still offers the no-category line by default in pick mode", async () => {
      renderChooser({ mode: "pick" });
      await screen.findByText("Groceries");
      expect(screen.getByTestId("chooser-option-none")).toBeVisible();
    });

    it("suppresses the no-category line when allowNone is false, and Enter reaches the first real item instead", async () => {
      const { onPick } = renderChooser({ mode: "pick", allowNone: false });
      await screen.findByText("Groceries");
      expect(screen.queryByTestId("chooser-option-none")).toBeNull();
      // With the none-line gone, the sequence indices shift back by one: a
      // bare Enter (no arrow presses) now lands on the first real item.
      const list = screen.getByRole("listbox");
      fireEvent.keyDown(list, { key: "Enter" });
      expect(onPick).toHaveBeenCalledWith("gro");
    });

    it("has no effect in multi mode, which never shows the none-line anyway", async () => {
      renderChooser({ mode: "multi", allowNone: false });
      await screen.findByText("Groceries");
      expect(screen.queryByTestId("chooser-option-none")).toBeNull();
    });
  });
});
