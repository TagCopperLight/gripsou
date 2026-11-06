import { describe, it, expect } from "vitest";

import en from "../../i18n/en.json";
import fr from "../../i18n/fr.json";
import { BUDGET_ICON_NAMES, BUDGET_ICONS } from "./budgetIcons";

describe("BUDGET_ICONS", () => {
  it("resolves every seeded icon name", () => {
    expect(BUDGET_ICON_NAMES).toHaveLength(35);
    for (const name of BUDGET_ICON_NAMES) expect(BUDGET_ICONS[name]).toBeTruthy();
    expect(Object.keys(BUDGET_ICONS).sort()).toEqual([...BUDGET_ICON_NAMES].sort());
  });

  it("has a label for every icon in both locales", () => {
    for (const name of BUDGET_ICON_NAMES) {
      expect(en.budget.icons[name as keyof typeof en.budget.icons]).toBeTruthy();
      expect(fr.budget.icons[name as keyof typeof fr.budget.icons]).toBeTruthy();
    }
  });
});
