import { describe, it, expect } from "vitest";
import i18n from "i18next";

import en from "../i18n/en.json";
import fr from "../i18n/fr.json";
import {
  BUDGET_ICON_NAMES,
  BUDGET_ICONS,
  BUDGET_KINDS,
  budgetIcon,
  categoryLabel,
  safeBudgetColor,
  sortCategories,
} from "./budget";
import type { BudgetCategory } from "../api/budget";

// A private i18next instance: the app singleton's language must not leak
// between test files.
const t = i18n.createInstance();
await t.init({ lng: "en", resources: { en: { translation: en }, fr: { translation: fr } } });

function cat(over: Partial<BudgetCategory> = {}): BudgetCategory {
  return {
    id: "c1", name: "Groceries", defaultKey: "groceries", color: "#9bb06b",
    icon: "shopping-cart", hint: null, kind: "expense", systemKey: null,
    archived: false, txCount: 0, ...over,
  };
}

describe("categoryLabel", () => {
  it("translates a seeded row", async () => {
    expect(categoryLabel(t.t, cat())).toBe("Groceries");
    await t.changeLanguage("fr");
    expect(categoryLabel(t.t, cat())).toBe("Courses");
    await t.changeLanguage("en");
  });

  it("falls back to the stored name when the default key is unknown", () => {
    expect(categoryLabel(t.t, cat({ defaultKey: "not_a_key", name: "Mystery" }))).toBe("Mystery");
  });

  it("shows a renamed row verbatim, even when its text looks like a key", () => {
    expect(categoryLabel(t.t, cat({ defaultKey: null, name: "groceries" }))).toBe("groceries");
    expect(categoryLabel(t.t, cat({ defaultKey: null, name: "Mes courses" }))).toBe("Mes courses");
  });
});

describe("safeBudgetColor", () => {
  it("passes a valid hex through and rejects anything else", () => {
    expect(safeBudgetColor("#9bb06b")).toBe("#9bb06b");
    expect(safeBudgetColor("#FFF")).toBe("#FFF");
    expect(safeBudgetColor(null)).toBe("#aeaaa7");
    expect(safeBudgetColor("")).toBe("#aeaaa7");
    expect(safeBudgetColor("red; background: url(x)")).toBe("#aeaaa7");
  });
});

describe("budgetIcon", () => {
  it("resolves every seeded icon name and nothing else", () => {
    expect(BUDGET_ICON_NAMES).toHaveLength(25);
    for (const name of BUDGET_ICON_NAMES) expect(budgetIcon(name)).toBeTruthy();
    expect(budgetIcon(null)).toBeNull();
    expect(budgetIcon("not-an-icon")).toBeNull();
    expect(Object.keys(BUDGET_ICONS).sort()).toEqual([...BUDGET_ICON_NAMES].sort());
  });

  it("has a label for every icon in both locales", () => {
    for (const name of BUDGET_ICON_NAMES) {
      expect(en.budget.icons[name as keyof typeof en.budget.icons]).toBeTruthy();
      expect(fr.budget.icons[name as keyof typeof fr.budget.icons]).toBeTruthy();
    }
  });
});

describe("sortCategories", () => {
  it("orders by kind and keeps the backend's order inside a kind", () => {
    const rows = [
      cat({ id: "x", kind: "excluded", name: "Ignore" }),
      cat({ id: "i2", kind: "internal", name: "Savings" }),
      cat({ id: "e2", kind: "expense", name: "Transport" }),
      cat({ id: "n1", kind: "income", name: "Salary" }),
      cat({ id: "e1", kind: "expense", name: "Groceries" }),
    ];
    expect(sortCategories(rows).map((c) => c.id)).toEqual(["e2", "e1", "n1", "i2", "x"]);
    expect(BUDGET_KINDS).toEqual(["expense", "income", "internal", "excluded"]);
  });
});
