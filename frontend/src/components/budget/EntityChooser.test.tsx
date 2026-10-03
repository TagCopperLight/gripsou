import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import userEvent from "@testing-library/user-event";

import { CategoryChooser } from "./CategoryChooser";
import { EntityChooser } from "./EntityChooser";
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
  cat({ id: "int", name: "Internal transfer", kind: "neutral", systemKey: "internal_transfer" }),
  cat({ id: "old", name: "Archived one", kind: "expense", archived: true }),
];

type ChooserOptions = { mode?: "multi" | "pick"; selectedIds?: string[]; allowNone?: boolean };

function renderChooser({ mode = "multi", selectedIds = [], allowNone }: ChooserOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const onToggle = vi.fn();
  const onPick = vi.fn();
  const onClose = vi.fn();
  const result = render(
    mode === "pick" ? (
      <CategoryChooser mode="pick" selectedIds={selectedIds} onPick={onPick} onClose={onClose} allowNone={allowNone} />
    ) : (
      <CategoryChooser mode="multi" selectedIds={selectedIds} onToggle={onToggle} onClose={onClose} />
    ),
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

  it("focuses the search field on open, so typing starts at once", () => {
    renderChooser();
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("groups the rows under their kind, in kind order, and hides archived ones", async () => {
    renderChooser();
    await screen.findByText("Groceries");
    const groups = screen.getAllByTestId("chooser-group").map((g) => g.textContent);
    expect(groups).toEqual(["EXPENSE", "INCOME", "NEUTRAL"]);
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
  });

  it("keeps focus in the search field across keyboard toggles, even as the parent re-renders", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A parent like the filter panel: every toggle updates its state, and its
    // close handler reads that state, so each render hands the chooser a new
    // one (the React Compiler can only reuse closures whose inputs are
    // unchanged).
    function Harness() {
      const [picked, setPicked] = useState<string[]>([]);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <button ref={setAnchor} type="button">
            open
          </button>
          <span data-testid="picked">{picked.join(",")}</span>
          {anchor && (
            <CategoryChooser
              mode="multi"
              selectedIds={picked}
              onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
              onClose={() => onClose(picked)}
              anchor={anchor}
            />
          )}
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await screen.findByText("Groceries");
    const search = screen.getByRole("searchbox");
    expect(search).toHaveFocus();

    await user.keyboard("gro{Enter}");
    expect(screen.getByTestId("picked").textContent).toBe("gro");
    expect(search).toHaveFocus();

    // Still in the field, so a second Enter toggles the line off again rather
    // than pressing the trigger behind the chooser.
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("picked").textContent).toBe("");
    expect(search).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tells assistive tech which line Enter would apply, and that several can be chosen", async () => {
    renderChooser();
    await screen.findByText("Groceries");
    const search = screen.getByRole("searchbox", { name: "Search" });
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    expect(search).toHaveAttribute("aria-controls", list.id);
    expect(search.getAttribute("aria-activedescendant")).toBe(screen.getByTestId("chooser-option-gro").id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(screen.getByTestId("chooser-option-fun").id);
  });

  describe("footer", () => {
    const items = [{ id: "a", label: "Alpha", render: <span>Alpha</span> }];

    it("renders the caller's footer under its own rule", () => {
      render(
        <EntityChooser
          title="t"
          items={items}
          mode="multi"
          selectedIds={[]}
          onToggle={vi.fn()}
          onClose={vi.fn()}
          footer={<button data-testid="chooser-save">Save</button>}
        />,
      );
      expect(screen.getByTestId("chooser-footer")).toContainElement(
        screen.getByTestId("chooser-save"),
      );
    });

    it("draws no footer band when the caller passes none", () => {
      render(
        <EntityChooser title="t" items={items} mode="multi" selectedIds={[]} onToggle={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.queryByTestId("chooser-footer")).toBeNull();
    });
  });
});
