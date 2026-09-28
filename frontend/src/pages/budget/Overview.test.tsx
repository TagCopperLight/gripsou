import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { BudgetOverview } from "./Overview";
import { BudgetProvider } from "../../components/budget/BudgetProvider";
import { useBudget } from "../../components/budget/budgetContext";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";
import { addMonths, currentMonth, monthLabel } from "../../lib/period";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// The page mounts two ECharts widgets (Sankey + Trend) at once. jsdom has no
// real canvas 2D context, and disposing/recreating two chart instances side
// by side inside the same act() batch flakes on that stub (a bare
// `TypeError: null.clearRect` from zrender's teardown) — the same reason
// router.test.tsx stubs the Dashboard's chart cards outright. TrendSurface's
// own test mocks this module for the same reason; mirror it here rather than
// let an environment limitation flake the page assembly's tests.
vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="chart-stub" />,
}));

const SUMMARY = {
  txnCount: 412,
  fxMissing: false,
  reportingFxMissing: false,
  figures: {
    income: { amount: "3200.00" },
    expenses: { amount: "1940.00" },
    net: { amount: "1260.00" },
    saved: { amount: "800.00" },
  },
  sankey: { sources: [], destinations: [], notSpent: "1260.00" },
  breakdown: [
    {
      slice: {
        kind: "category",
        category: { id: "c1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null },
      },
      amount: "1200.00",
      txnCount: 1,
    },
  ],
};

const TREND = { months: ["2026-09"], series: [] };

const AI_STATUS = {
  configured: false,
  running: false,
  remaining: 0,
  reviewCount: 0,
  lastRun: null,
};

/** A local-noon timestamp in `month`, as a transaction row's `t`. */
const inMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 15, 12).getTime();
};

type Data = {
  /** The newest row's month, or null for no transactions at all. */
  latest?: string | null;
  /** How many rows lie before the month asked about. */
  before?: number;
};

function stubApi(summary: unknown = SUMMARY, data: Data = {}) {
  const { latest = currentMonth(), before = 5 } = data;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const counts = {
        matching: before, total: before, uncategorized: 0, matchingTotal: "0",
        fxMissing: false, reportingFxMissing: false,
      };
      const rows = latest === null ? [] : [{ id: "x", t: inMonth(latest) }];
      const body = u.includes("/budget/trend")
        ? TREND
        : u.includes("/budget/categorize/status")
          ? AI_STATUS
          : u.includes("/transactions/counts")
            ? counts
            : u.includes("/transactions")
              ? rows
              : summary;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

const requested = (fragment: string) =>
  vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes(fragment));

function FilterProbe() {
  const { filters, patchFilters } = useBudget();
  return (
    <>
      <span data-testid="filters">{JSON.stringify(filters)}</span>
      <button
        type="button"
        onClick={() => patchFilters({ search: "aldi", needsReview: true, transfers: true })}
      >
        leftovers
      </button>
    </>
  );
}

// FiguresSurface renders amounts through PrivateMoney, which calls useAuth —
// mirroring PrivateMoney.test.tsx's wrapper rather than the plain provider
// the brief's own snippet used, which throws outside an AuthProvider.
const authValue: AuthValue = {
  isAuthenticated: true,
  user: { id: "1", name: "A", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS },
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: async () => {},
  adoptSession: () => {},
  logout: async () => {},
  updateUser: () => {},
  updatePrefs: async () => {},
};

function renderPage(extra?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue}>
        <BudgetProvider>
          <BudgetOverview />
          {extra}
        </BudgetProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

describe("BudgetOverview", () => {
  it("renders the period line and the four figures", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("figure-income")).toBeVisible());
    expect(screen.getByTestId("period-count")).toHaveTextContent("412");
  });

  it("replaces the last three surfaces when the period is empty", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-period")).toBeVisible());
    // The figures stay — at zero, which is a true statement about the period.
    expect(screen.getByTestId("figure-income")).toBeVisible();
    expect(screen.queryByTestId("sankey-see-transactions")).toBeNull();
    expect(screen.queryByTestId("breakdown-row-cat:c1")).toBeNull();
  });

  it("opens on the latest month that has transactions, not the empty current one", async () => {
    const lastMonth = addMonths(currentMonth(), -1);
    stubApi(SUMMARY, { latest: lastMonth });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("period-label")).toHaveTextContent(monthLabel(lastMonth, "en")),
    );
    expect(requested(`month=${lastMonth}`)).toBe(true);
    expect(requested(`month=${currentMonth()}`)).toBe(false);
    // The latest data is the forward edge.
    expect(screen.getByTestId("period-next")).toBeDisabled();
  });

  it("keeps the back caret for an empty month with data before it", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] }, { before: 12 });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-period")).toBeVisible());
    await waitFor(() => expect(screen.getByTestId("period-prev")).toBeEnabled());
    fireEvent.click(screen.getByTestId("period-prev"));
    const expectedMonth = addMonths(currentMonth(), -1);
    await waitFor(() =>
      expect(screen.getByTestId("period-label")).toHaveTextContent(monthLabel(expectedMonth, "en")),
    );
    await waitFor(() => expect(requested(`month=${expectedMonth}`)).toBe(true));
  });

  it("disables the back caret, and offers no way earlier, before the first data", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] }, { before: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("period-prev")).toBeDisabled());
    expect(screen.queryByTestId("empty-earlier")).toBeNull();
  });

  it("does not ask for the trend when the empty state hides it", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-period")).toBeVisible());
    expect(requested("/budget/trend")).toBe(false);
  });

  it("draws no Sankey and no table for a period with nothing to show in them", async () => {
    stubApi({ ...SUMMARY, sankey: { sources: [], destinations: [] }, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("figure-income")).toBeVisible());
    expect(screen.queryByTestId("sankey-see-transactions")).toBeNull();
    expect(screen.queryByText("Categories")).toBeNull();
  });

  it("shows the pivot-currency notice when the reporting rate is missing", async () => {
    stubApi({ ...SUMMARY, reportingFxMissing: true });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("reporting-fx-missing")).toBeVisible());
  });

  it("deep-links a category row with the period and the category", async () => {
    renderPage(<FilterProbe />);
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/transactions" });
    const filters = JSON.parse(screen.getByTestId("filters").textContent!);
    expect(filters.categoryIds).toEqual(["c1"]);
    // The period itself, not a label: the chip is worded at render time, in
    // whatever language is current then.
    expect(filters.period).toEqual({ mode: "month", month: currentMonth() });
    expect(filters.from).toBe(`${currentMonth()}-01`);
    // The select shows the dates that apply, not "All time".
    expect(filters.timeFrame).toBe("custom");
  });

  it("resets the review and transfer filters so the list matches the figure clicked", async () => {
    renderPage(<FilterProbe />);
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByText("leftovers"));
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    const filters = JSON.parse(screen.getByTestId("filters").textContent!);
    expect(filters.needsReview).toBe(false);
    expect(filters.transfers).toBe(false);
    // The reader's own narrowing stays.
    expect(filters.search).toBe("aldi");
  });

  it("writes the flag and the outflow bucket for the uncategorised row", async () => {
    // It has no id to filter on. `bucket: "out"` is required as well as the
    // flag: the breakdown counts only the outflow half, while the flag alone
    // would also match uncategorised income.
    stubApi({
      ...SUMMARY,
      breakdown: [{ slice: { kind: "uncategorised" }, amount: "180.00", txnCount: 9 }],
    });
    renderPage(<FilterProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("breakdown-row-uncategorised")).toBeVisible(),
    );
    fireEvent.click(screen.getByTestId("breakdown-row-uncategorised"));
    const filters = screen.getByTestId("filters").textContent!;
    expect(filters).toContain('"uncategorized":true');
    expect(filters).toContain('"bucket":"out"');
    expect(filters).not.toContain('"categoryIds":["');
  });

  it("does not let a stale slice filter from an earlier deep link survive a later one", async () => {
    // Uncategorised first (sets uncategorized:true, bucket:"out"), then a
    // category row: without a reset, patchFilters' merge would leave BOTH
    // set, which the backend ANDs into an always-empty list (I1).
    stubApi({
      ...SUMMARY,
      breakdown: [
        ...SUMMARY.breakdown,
        { slice: { kind: "uncategorised" }, amount: "180.00", txnCount: 9 },
      ],
    });
    renderPage(<FilterProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("breakdown-row-uncategorised")).toBeVisible(),
    );
    fireEvent.click(screen.getByTestId("breakdown-row-uncategorised"));
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));

    const filters = screen.getByTestId("filters").textContent!;
    expect(filters).toContain('"categoryIds":["c1"]');
    expect(filters).toContain('"uncategorized":false');
    expect(filters).toContain('"bucket":"all"');
  });

  it("does not let a stale category filter from an earlier deep link leak into See transactions", async () => {
    renderPage(<FilterProbe />);
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    fireEvent.click(screen.getByTestId("sankey-see-transactions"));

    const filters = screen.getByTestId("filters").textContent!;
    expect(filters).toContain('"categoryIds":[]');
  });
});
