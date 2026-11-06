import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { FiguresSurface } from "./FiguresSurface";
import type { BudgetSummary } from "../../../api/wire";
import { DEFAULT_PREFS, type UserPrefs } from "../../../api/wire";
import { renderWithApp } from "../../../test/kit";

function summary(over: Partial<BudgetSummary["figures"]> = {}): BudgetSummary {
  return {
    txnCount: 412,
    fxMissing: false,
    figures: {
      income: { amount: "3200.00", prevMonth: "2980.00", avg12: "3050.00" },
      expenses: { amount: "1940.00", prevMonth: "2010.00", avg12: "1870.00" },
      net: { amount: "1260.00", prevMonth: "970.00", avg12: "1179.00" },
      ...over,
    },
    sankey: { sources: [], destinations: [] },
    breakdown: [],
  };
}

// The figures' privacy mask reads `useAuth()`.
function renderSurface(sum: BudgetSummary, prefs: UserPrefs = DEFAULT_PREFS) {
  return renderWithApp(<FiguresSurface summary={sum} />, { prefs });
}

describe("FiguresSurface", () => {
  it("renders income's comparison as a percentage", () => {
    renderSurface(summary());
    // 3200 vs 2980 → +7,4 %
    expect(screen.getByTestId("figure-income")).toHaveTextContent("%");
  });

  it("renders net's comparison as an absolute amount, never a percentage", () => {
    renderSurface(summary());
    // Net can be zero or negative, where a percentage change is meaningless.
    expect(screen.getByTestId("figure-net")).not.toHaveTextContent("%");
  });

  it("hides both comparisons when the server sends no baseline", () => {
    // A date range, or a month with too little history before it: the server
    // omits both keys together.
    renderSurface(
      summary({
        income: { amount: "3200.00" },
        expenses: { amount: "1940.00" },
        net: { amount: "1260.00" },
      }),
    );
    expect(screen.queryByTestId("cmp-income-prevMonth")).toBeNull();
    expect(screen.queryByTestId("cmp-income-avg12")).toBeNull();
  });

  it("falls back to an absolute delta when a percentage baseline is zero", () => {
    renderSurface(summary({ income: { amount: "3200.00", prevMonth: "0.00", avg12: "3050.00" } }));
    expect(screen.getByTestId("cmp-income-prevMonth")).not.toHaveTextContent("%");
    expect(screen.getByTestId("cmp-income-avg12")).toHaveTextContent("%");
  });
});
