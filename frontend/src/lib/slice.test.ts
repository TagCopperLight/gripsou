import { describe, it, expect } from "vitest";
import i18n from "../i18n";

import {
  OTHER_COLOR,
  UNCATEGORISED_COLOR,
  sliceCategory,
  sliceChip,
  sliceColor,
  sliceKey,
  sliceLabel,
} from "./slice";
import type { Slice } from "../api/overview";

const groceries: Slice = {
  kind: "category",
  category: {
    id: "c1",
    name: "Groceries",
    defaultKey: null,
    color: "#8fd05f",
    icon: "ShoppingCart",
    kind: "expense",
  },
};

describe("sliceKey", () => {
  it("keys a category by its id", () => {
    expect(sliceKey(groceries)).toBe("cat:c1");
  });

  it("keys the two singletons by their kind", () => {
    expect(sliceKey({ kind: "uncategorised" })).toBe("uncategorised");
    expect(sliceKey({ kind: "other" })).toBe("other");
  });

  it("gives uncategorised income and uncategorised expense the same key", () => {
    // They are the same slice; the Sankey is what has to tell its two SIDES
    // apart, and it prefixes this key rather than changing it.
    expect(sliceKey({ kind: "uncategorised" })).toBe(sliceKey({ kind: "uncategorised" }));
  });
});

describe("sliceColor", () => {
  it("uses the category's own colour", () => {
    expect(sliceColor(groceries)).toBe("#8fd05f");
  });

  it("falls back for a category whose colour is not a hex", () => {
    expect(
      sliceColor({ ...groceries, category: { ...groceries.category, color: "chartreuse" } }),
    ).toBe("#aeaaa7");
  });

  it("paints uncategorised amber and other neutral", () => {
    expect(sliceColor({ kind: "uncategorised" })).toBe(UNCATEGORISED_COLOR);
    expect(sliceColor({ kind: "other" })).toBe(OTHER_COLOR);
  });
});

describe("sliceLabel", () => {
  it("labels a renamed category verbatim", () => {
    expect(sliceLabel(i18n.t, groceries)).toBe("Groceries");
  });

  it("labels the two singletons from i18n", () => {
    expect(sliceLabel(i18n.t, { kind: "uncategorised" })).toBe(i18n.t("budget.uncategorized"));
    expect(sliceLabel(i18n.t, { kind: "other" })).toBe(i18n.t("budget.overview.other"));
  });
});

describe("sliceCategory", () => {
  it("returns the ref for a category slice", () => {
    expect(sliceCategory(groceries)?.id).toBe("c1");
  });

  it("returns null for the singletons, which have no id to deep-link on", () => {
    expect(sliceCategory({ kind: "uncategorised" })).toBeNull();
    expect(sliceCategory({ kind: "other" })).toBeNull();
  });
});

describe("sliceChip", () => {
  it("passes a real category straight through", () => {
    expect(sliceChip(i18n.t, groceries)?.name).toBe("Groceries");
  });

  it("gives uncategorised the chip's own no-category state", () => {
    // `null` is what CategoryChip already paints amber and labels
    // "Uncategorised" — nothing synthetic is needed.
    expect(sliceChip(i18n.t, { kind: "uncategorised" })).toBeNull();
  });

  it("synthesises a neutral chip for the rollup", () => {
    const chip = sliceChip(i18n.t, { kind: "other" });
    expect(chip?.name).toBe(i18n.t("budget.overview.other"));
    expect(chip?.color).toBe(OTHER_COLOR);
  });
});
