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
  currency: "EUR",
  txnCount: 412,
  fxMissing: false,
  reportingFxMissing: false,
  comparable: true,
  figures: {
    income: { amount: "3200.00" },
    expenses: { amount: "1940.00" },
    net: { amount: "1260.00" },
    saved: { amount: "800.00" },
  },
  sankey: { sources: [], destinations: [] },
  breakdown: [
    {
      slice: {
        kind: "category",
        category: { id: "c1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null, kind: "expense" },
      },
      amount: "1200.00",
      txnCount: 1,
    },
  ],
  expensesTotal: "1940.00",
};

const TREND = { months: ["2026-09"], series: [] };

const AI_STATUS = {
  configured: false,
  enabled: false,
  running: false,
  remaining: 0,
  reviewCount: 0,
  threshold: 80,
  lastRun: null,
};

function stubApi(summary: unknown = SUMMARY) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/budget/trend")
        ? TREND
        : String(url).includes("/budget/categorize/status")
          ? AI_STATUS
          : summary;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function FilterProbe() {
  const { filters } = useBudget();
  return <span data-testid="filters">{JSON.stringify(filters)}</span>;
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

  it("steps past the disabled back caret from the empty surface", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-period")).toBeVisible());
    expect(screen.getByTestId("period-prev")).toBeDisabled();
    // Was only "the label is visible", true whether or not the click moved
    // anything (M8) — assert it actually moved to the PREVIOUS month, both by
    // the label text and by the request that goes out for it.
    const before = screen.getByTestId("period-label").textContent;
    fireEvent.click(screen.getByTestId("empty-earlier"));
    await waitFor(() =>
      expect(screen.getByTestId("period-label")).not.toHaveTextContent(before!),
    );
    const expectedMonth = addMonths(currentMonth(), -1);
    expect(screen.getByTestId("period-label")).toHaveTextContent(
      monthLabel(expectedMonth, "en"),
    );
    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining(`month=${expectedMonth}`),
        expect.anything(),
      ),
    );
  });

  it("deep-links a breakdown row with the period and the category", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/transactions" });
  });

  it("shows the pivot-currency notice when the reporting rate is missing", async () => {
    stubApi({ ...SUMMARY, reportingFxMissing: true });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("reporting-fx-missing")).toBeVisible());
  });

  it("writes the period and the category id for a category row", async () => {
    renderPage(<FilterProbe />);
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    const filters = screen.getByTestId("filters").textContent!;
    expect(filters).toContain('"categoryIds":["c1"]');
    expect(filters).toContain('"periodLabel"');
    expect(filters).toContain('"from":"');
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
