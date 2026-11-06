import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CategoryChip } from "./CategoryChip";
import type { BudgetCategory } from "../../api/wire";
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
});
