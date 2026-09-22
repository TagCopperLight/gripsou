import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CategoryChip } from "./CategoryChip";
import { TagChip } from "./TagChip";
import type { BudgetCategory } from "../../api/budget";
import "../../i18n";

const GROCERIES: BudgetCategory = {
  id: "c1", name: "Groceries", defaultKey: "groceries", color: "#9bb06b",
  icon: "shopping-cart", hint: null, kind: "expense", systemKey: null,
  archived: false, txCount: 3,
};

describe("CategoryChip", () => {
  it("shows the translated name with a soft fill of the category colour", () => {
    render(<CategoryChip category={GROCERIES} />);
    const chip = screen.getByTestId("category-chip");
    expect(chip).toHaveTextContent("Groceries");
    expect(chip).toHaveAttribute("title", "Groceries");
    // Opaque: the 22% tint is flattened against the surface, so a selected or
    // hovered row never shows through and shifts the chip's colour.
    expect(chip.style.backgroundColor).toBe("rgb(49, 52, 35)");
    expect(chip.style.color).toBe("rgb(155, 176, 107)");
    // The name is to the LEFT of the icon (spec §5).
    expect(chip.querySelector("span")?.textContent).toBe("Groceries");
    expect(chip.querySelector("svg")).toBeTruthy();
  });

  it("falls back to grey when the stored colour is not a hex value", () => {
    render(<CategoryChip category={{ ...GROCERIES, color: "chartreuse" }} />);
    expect(screen.getByTestId("category-chip").style.color).toBe("rgb(174, 170, 167)");
  });

  it("renders the no-category chip in amber with a dot", () => {
    render(<CategoryChip category={null} />);
    const chip = screen.getByTestId("category-chip");
    expect(chip).toHaveTextContent("Uncategorised");
    expect(chip).toHaveAttribute("data-variant", "uncategorized");
    expect(chip.style.color).toBe("rgb(240, 185, 82)");
    expect(chip.querySelector("svg")).toBeTruthy();   // the dot
  });

  it("drops the fill and draws a dotted outline when the guess needs review", () => {
    render(<CategoryChip category={GROCERIES} needsReview />);
    const chip = screen.getByTestId("category-chip");
    expect(chip.className).toContain("border-dotted");
    expect(chip.style.backgroundColor).toBe("");
  });

  it("truncates a long name but keeps it reachable as the accessible title", () => {
    const long = "A very long category name that will not fit in one chip";
    render(<CategoryChip category={{ ...GROCERIES, defaultKey: null, name: long }} />);
    const chip = screen.getByTestId("category-chip");
    expect(chip).toHaveAttribute("title", long);
    expect(chip.querySelector("span")?.className).toContain("truncate");
  });
});

describe("TagChip", () => {
  it("is smaller, less rounded, and always carries the tag icon", () => {
    render(<TagChip tag={{ name: "Holiday", color: "#5b9bf0" }} />);
    const chip = screen.getByTestId("tag-chip");
    expect(chip).toHaveTextContent("Holiday");
    expect(chip.querySelector("svg")).toBeTruthy();
    expect(chip.className).toContain("rounded-md");
    expect(chip.style.color).toBe("rgb(91, 155, 240)");
  });

  it("uses the neutral colour when the tag has none", () => {
    render(<TagChip tag={{ name: "Holiday", color: null }} />);
    expect(screen.getByTestId("tag-chip").style.color).toBe("rgb(174, 170, 167)");
  });
});
