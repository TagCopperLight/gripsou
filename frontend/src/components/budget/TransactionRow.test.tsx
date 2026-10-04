import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";

import { TransactionRow } from "./TransactionRow";
import type { Transaction } from "../../api/types";

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t1", t: Date.UTC(2026, 8, 12, 12), type: "withdrawal", description: "ALDI SARL 1234",
    amount: "-12.40", amountReporting: "-12.40", currency: "EUR", accountId: "a", accountName: "Current",
    accountColor: "#5b9bf0", source: "cash", ticker: null, logo: null, quantity: null, unitPrice: null,
    fee: null, categoryId: null, categoryName: null, categoryDefaultKey: null,
    categoryColor: null, categoryIcon: null, categoryKind: null, categorySource: null,
    categoryConfidence: null, needsReview: false, checked: false, isTransfer: false,
    isOrphanTransfer: false,
    tags: [], ...over,
  };
}

function renderRow(over: Partial<Transaction> = {}, props: Record<string, unknown> = {}) {
  const handlers = {
    onToggleSelect: vi.fn(),
    onOpenCategory: vi.fn(),
    onOpenTags: vi.fn(),
    onToggleChecked: vi.fn(),
  };
  render(
    <table>
      <tbody>
        <TransactionRow
          tx={tx(over)}
          showChecked={false}
          selected={false}
          anySelected={false}
          {...handlers}
          {...props}
        />
      </tbody>
    </table>,
  );
  return handlers;
}

describe("TransactionRow", () => {
  it("draws the description, the account and the amount in its own currency", () => {
    renderRow();
    expect(screen.getByTestId("tx-description")).toHaveTextContent("ALDI SARL 1234");
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getByTestId("tx-amount").textContent).toContain("12,40");
  });

  it("shows the uncategorised chip and opens the chooser when it is clicked", () => {
    const h = renderRow();
    const chip = screen.getByTestId("category-chip");
    expect(chip).toHaveAttribute("data-variant", "uncategorized");
    fireEvent.click(chip);
    expect(h.onOpenCategory).toHaveBeenCalled();
  });

  it("marks an unreviewed AI guess differently from a confirmed category", () => {
    renderRow({
      categoryId: "c1", categoryName: "Groceries", categoryIcon: "shopping-cart",
      categoryColor: "#9bb06b", categoryKind: "expense", categorySource: "ai",
      categoryConfidence: "0.42", needsReview: true,
    });
    expect(screen.getByTestId("category-chip").className).toContain("outline-dashed");
  });

  it("dims an internal transfer and says it was auto paired", () => {
    renderRow({ isTransfer: true, categoryId: "c1", categoryName: "Groceries", categoryColor: "#9bb06b" });
    expect(screen.getByTestId("tx-transfer-note")).toBeVisible();
    // Dimmed cell by cell, so the two colour-bearing ones keep full strength.
    expect(screen.getByTestId("tx-amount").className).toContain("opacity-60");
    // The cell itself is never dimmed: its background is the selection/hover colour.
    expect(screen.getByTestId("tx-amount").closest("td")!.className).not.toContain("opacity-60");
    expect(screen.getByTestId("tx-avatar").closest("td")!.className).not.toContain("opacity-60");
    expect(screen.getByTestId("category-chip").closest("td")!.className).not.toContain("opacity-60");
    expect(screen.getByTestId("tx-tags").className).not.toContain("opacity-60");
  });

  it("renders a lot row with its instrument line and no budget affordances", () => {
    renderRow({
      source: "lot", type: "buy", description: null, ticker: "CW8",
      quantity: "3", unitPrice: "512.30", amount: "-1536.90",
    });
    expect(screen.getByTestId("tx-lot-line")).toHaveTextContent("CW8");
    expect(screen.queryByTestId("category-chip")).toBeNull();
    expect(screen.queryByTestId("tx-add-tag")).toBeNull();
  });

  it("exposes no selection checkbox and no checked checkbox on a lot row", () => {
    // The server's assignment/bulk endpoints only ever touch the `transaction`
    // table, so a lot row must offer
    // neither control — not even a disabled one — the way its category and
    // tag cells already behave. The avatar stays visible in their place.
    renderRow(
      {
        source: "lot", type: "buy", description: null, ticker: "CW8",
        quantity: "3", unitPrice: "512.30", amount: "-1536.90",
      },
      { showChecked: true, anySelected: true },
    );
    expect(screen.queryByTestId("tx-select")).toBeNull();
    expect(screen.queryByTestId("tx-checked")).toBeNull();
    expect(screen.getByTestId("tx-avatar")).toBeVisible();
  });

  it("swaps the avatar for a checkbox once anything is selected", () => {
    const h = renderRow({}, { anySelected: true, selected: true });
    expect(screen.queryByTestId("tx-avatar")).toBeNull();
    const box = screen.getByTestId("tx-select");
    expect(box).toBeChecked();
    expect(screen.getByTestId("tx-row").className).toContain("bg-green");
    fireEvent.click(box);
    expect(h.onToggleSelect).toHaveBeenCalledWith("t1");
  });

  it("renders the ✓ column only when the preference is on", () => {
    renderRow();
    expect(screen.queryByTestId("tx-checked")).toBeNull();
    const h = renderRow({ checked: true }, { showChecked: true });
    const box = screen.getByTestId("tx-checked");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(h.onToggleChecked).toHaveBeenCalled();
  });

  it("lists the row's tags and offers adding one", () => {
    const h = renderRow({ tags: [{ id: "g1", name: "holiday", color: "#f0b952" }] });
    // Two matches: the chip on the line, and the invisible twin `TagCell`
    // measures the full line with. The first one is the visible one.
    expect(within(screen.getByTestId("tx-tags")).getAllByText("holiday")[0]).toBeVisible();
    fireEvent.click(screen.getByTestId("tx-add-tag"));
    expect(h.onOpenTags).toHaveBeenCalled();
  });

  it("keeps the selection checkbox reachable by keyboard even before anything is selected", () => {
    // Regression guard: the checkbox must never fall back to `hidden` /
    // display:none, which would both drop it from the tab order and hide it
    // from assistive tech. jsdom doesn't evaluate Tailwind, so this only
    // proves DOM presence, an accessible-name lookup, absence of the
    // `hidden` class, and that a plain click (no hover) still fires the
    // handler — not that it is visually revealed on hover/focus.
    const h = renderRow({}, { anySelected: false, selected: false });
    const box = screen.getByRole("checkbox", { name: "Select this transaction: ALDI SARL 1234" });
    expect(box).toBe(screen.getByTestId("tx-select"));
    expect(box.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.click(box);
    expect(h.onToggleSelect).toHaveBeenCalledWith("t1");
  });

  it("keeps the add-tag button reachable by keyboard, and still absent on a lot row", () => {
    // Mirrors the checkbox regression guard above: the add-tag affordance
    // must never fall back to `hidden`/display:none. jsdom doesn't evaluate
    // Tailwind, so this only proves DOM presence, an accessible-name lookup,
    // absence of the `hidden` class, and that a plain click (no hover) still
    // fires the handler — not that it is visually revealed on hover/focus.
    const h = renderRow({ tags: [{ id: "g1", name: "holiday", color: "#f0b952" }] });
    const addTag = screen.getByRole("button", { name: "Add tags: ALDI SARL 1234" });
    expect(addTag).toBe(screen.getByTestId("tx-add-tag"));
    expect(addTag.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.click(addTag);
    expect(h.onOpenTags).toHaveBeenCalled();
    cleanup();

    // The lot-row isolation rule must survive: no tag affordance at all,
    // hidden or otherwise, on an investment record.
    renderRow({
      source: "lot", type: "buy", description: null, ticker: "CW8",
      quantity: "3", unitPrice: "512.30", amount: "-1536.90",
    });
    expect(screen.queryByTestId("tx-add-tag")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add tags/ })).toBeNull();
  });

  it("names each control after its own row, so a screen reader can tell them apart", () => {
    renderRow({}, { showChecked: true });
    expect(screen.getByRole("checkbox", { name: "Select this transaction: ALDI SARL 1234" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a category: ALDI SARL 1234" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    expect(screen.getByRole("button", { name: "Add tags: ALDI SARL 1234" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    expect(screen.getByRole("checkbox", { name: "Checked: ALDI SARL 1234" })).toBeInTheDocument();
  });

  it("warns that an orphaned transfer no longer nets out", () => {
    renderRow({
      isOrphanTransfer: true, categoryId: "c1", categoryName: "Internal transfer",
      categoryColor: "#9bb06b", categorySource: "pair",
    });
    expect(screen.getByTestId("tx-orphan-note")).toBeVisible();
    expect(screen.queryByTestId("tx-transfer-note")).not.toBeInTheDocument();
  });

  // An orphan is a row that wants attention. Dimming it — which is what marks a
  // live transfer as already handled — would work against the warning.
  it("does not dim an orphaned transfer", () => {
    renderRow({ isOrphanTransfer: true, categorySource: "pair" });
    expect(screen.getByTestId("tx-description").className).not.toContain("opacity-60");
  });
});
