import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CategoryChip } from "./CategoryChip";
import type { BudgetCategory } from "../../api/budget";
import "../../i18n";

const GROCERIES: BudgetCategory = {
  id: "c1", name: "Groceries", defaultKey: "groceries", color: "#9bb06b",
  icon: "shopping-cart", hint: null, kind: "expense", systemKey: null,
  archived: false, txCount: 3,
};

describe("CategoryChip", () => {
  it("falls back to grey when the stored colour is not a hex value", () => {
    render(<CategoryChip category={{ ...GROCERIES, color: "chartreuse" }} />);
    expect(screen.getByTestId("category-chip").style.color).toBe("rgb(174, 170, 167)");
  });

  it("drops the fill and draws a dashed outline when the guess needs review", () => {
    render(<CategoryChip category={GROCERIES} needsReview />);
    const chip = screen.getByTestId("category-chip");
    expect(chip.className).toContain("outline-dashed");
    expect(chip.style.backgroundColor).toBe("");
  });
});
