import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { FiguresSurface } from "./FiguresSurface";
import type { BudgetSummary } from "../../../api/overview";
import { AuthContext, type AuthValue } from "../../../auth/context";
import { DEFAULT_PREFS, type UserPrefs } from "../../../lib/prefs";

function summary(over: Partial<BudgetSummary["figures"]> = {}, comparable = true): BudgetSummary {
  return {
    currency: "EUR",
    txnCount: 412,
    fxMissing: false,
    reportingFxMissing: false,
    comparable,
    figures: {
      income: { amount: "3200.00", prevMonth: "2980.00", avg12: "3050.00" },
      expenses: { amount: "1940.00", prevMonth: "2010.00", avg12: "1870.00" },
      net: { amount: "1260.00", prevMonth: "970.00", avg12: "1179.00" },
      saved: { amount: "800.00", prevMonth: "800.00", avg12: "750.00" },
      ...over,
    },
    sankey: { sources: [], destinations: [] },
    breakdown: [],
    expensesTotal: "1940.00",
  };
}

// FigureCell renders `PrivateMoney`, which reads `useAuth()` — there is no
// default AuthProvider bootstrap in a bare render, so every test needs an
// AuthContext.Provider (mirrors PrivateMoney.test.tsx's own mechanism,
// rather than inventing a second one around the lib/prefs singleton).
function renderSurface(sum: BudgetSummary, prefs: UserPrefs = DEFAULT_PREFS) {
  const authValue: AuthValue = {
    isAuthenticated: true,
    user: { id: "1", name: "A", email: "a@t.local", role: "user", prefs },
    isBootstrapping: false,
    prefs,
    login: async () => {},
    adoptSession: () => {},
    logout: async () => {},
    updateUser: () => {},
    updatePrefs: async () => {},
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <FiguresSurface summary={sum} />
    </AuthContext.Provider>,
  );
}

describe("FiguresSurface", () => {
  it("shows all four figures", () => {
    renderSurface(summary());
    expect(screen.getByTestId("figure-income")).toHaveTextContent("3");
    expect(screen.getByTestId("figure-expenses")).toBeVisible();
    expect(screen.getByTestId("figure-net")).toBeVisible();
    expect(screen.getByTestId("figure-saved")).toBeVisible();
  });

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

  it("calls falling expenses good and rising expenses bad", () => {
    renderSurface(summary());
    // 1940 vs 2010 — spending less is the good direction.
    expect(screen.getByTestId("cmp-expenses-prevMonth")).toHaveAttribute("data-tone", "good");

    renderSurface(summary({ expenses: { amount: "2100.00", prevMonth: "2010.00" } }));
    expect(screen.getAllByTestId("cmp-expenses-prevMonth")[1]).toHaveAttribute(
      "data-tone",
      "bad",
    );
  });

  it("marks an unchanged figure neutral", () => {
    renderSurface(summary());
    // saved: 800 vs 800.
    expect(screen.getByTestId("cmp-saved-prevMonth")).toHaveAttribute("data-tone", "flat");
  });

  it("hides both comparisons under a custom range", () => {
    renderSurface(
      summary(
        {
          income: { amount: "3200.00" },
          expenses: { amount: "1940.00" },
          net: { amount: "1260.00" },
          saved: { amount: "800.00" },
        },
        false,
      ),
    );
    expect(screen.queryByTestId("cmp-income-prevMonth")).toBeNull();
    expect(screen.queryByTestId("cmp-income-avg12")).toBeNull();
  });

  it("renders one comparison when only one key is present", () => {
    // A month with under three months of history comes back comparable:true
    // with prevMonth absent — the two signals are independent (trap 1).
    renderSurface(summary({ income: { amount: "3200.00", avg12: "3050.00" } }));
    expect(screen.queryByTestId("cmp-income-prevMonth")).toBeNull();
    expect(screen.getByTestId("cmp-income-avg12")).toBeVisible();
  });

  it("falls back to an absolute delta when a percentage baseline is zero", () => {
    renderSurface(summary({ income: { amount: "3200.00", prevMonth: "0.00" } }));
    expect(screen.getByTestId("cmp-income-prevMonth")).not.toHaveTextContent("%");
  });

  it("masks the four figures in private mode", () => {
    renderSurface(summary(), { ...DEFAULT_PREFS, privateMode: true });
    expect(screen.getByTestId("figure-income")).toHaveTextContent("*");
  });

  it("scopes the separator to each breakpoint's own siblings instead of a fixed 'not first' rule (M7)", () => {
    // Every cell shares one class string — the `sm:even:`/`lg:not-first:`
    // pseudo-selectors are what makes the bar land only where a cell is
    // actually beside a predecessor at that column count. Before the fix,
    // `sm:not-first:border-l` also barred the 3rd cell (`net`), which on the
    // 2-column `sm` grid is the FIRST cell of its own row — a stray bar.
    renderSurface(summary());
    const className = screen.getByTestId("figure-income").className;
    // Every FigureCell renders the identical string — assert it directly
    // rather than by index, since Tailwind applies these through CSS sibling
    // selectors (`:nth-child(even)`, `:not(:first-child)`), not per-instance
    // markup.
    expect(className).toContain("sm:even:border-l");
    expect(className).toContain("lg:not-first:border-l");
    expect(className).not.toContain("sm:not-first:border-l");
  });
});
