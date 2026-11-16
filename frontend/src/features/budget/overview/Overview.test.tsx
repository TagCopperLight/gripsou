import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

import { BudgetOverview } from "./Overview";
import { BudgetProvider } from "../BudgetProvider";
import { useBudget } from "../budgetContext";
import { DEFAULT_PREFS } from "../../../api/wire";
import { currentMonth, monthLabel } from "../../../lib/period";
import { addMonths } from "../../../lib/month";
import { renderWithApp, stubFetch } from "../../../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// jsdom has no canvas 2D context, and tearing two charts down in one act() batch throws from zrender (`null.clearRect`).
vi.mock("../../../ui/EChart", () => ({
  default: () => <div data-testid="chart-stub" />,
}));

const SUMMARY = {
  txnCount: 412,
  fxMissing: false,
  figures: {
    income: { amount: "3200.00" },
    expenses: { amount: "1940.00" },
    net: { amount: "1260.00" },
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

const inMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 15, 12).getTime();
};

type Data = {
  latest?: string | null;
  before?: number;
};

function stubApi(summary: unknown = SUMMARY, data: Data = {}) {
  const { latest = currentMonth(), before = 5 } = data;
  stubFetch(async (url: string) => {
      const u = String(url);
      const counts = {
        matching: before, total: before, uncategorized: 0, matchingTotal: "0",
        fxMissing: false,
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
    });
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

function renderPage(extra?: ReactNode, prefs = DEFAULT_PREFS) {
  renderWithApp(
    <BudgetProvider>
      <BudgetOverview />
      {extra}
    </BudgetProvider>,
    { prefs },
  );
}

beforeEach(() => {
  navigate.mockClear();
  stubApi();
});
afterEach(() => vi.unstubAllGlobals());

describe("BudgetOverview", () => {
  it("shows its frame, controls off, while the period and the summary load", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderPage();
    expect(await screen.findByTestId("period-range")).toBeDisabled();
    expect(screen.getByTestId("period-prev")).toBeDisabled();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("in private mode, hides every amount behind one eye in the period line, shares kept", async () => {
    renderPage(undefined, { ...DEFAULT_PREFS, privateMode: true });
    await waitFor(() => expect(screen.getByTestId("figure-income")).toHaveTextContent("*"));
    const amounts = /3\D?200|1\D?940|1\D?260|1\D?200/;
    expect(document.body.textContent).not.toMatch(amounts);
    expect(screen.getByTestId("share")).toHaveTextContent("%");
    const eyes = screen.getAllByRole("button", { name: "Show amount" });
    expect(eyes).toHaveLength(1);
    fireEvent.click(eyes[0]);
    expect(screen.getByTestId("figure-income").textContent).toMatch(/3\D?200/);
    expect(document.body.textContent).toMatch(/1\D?200/);
  });

  it("replaces the last three surfaces when the period is empty", async () => {
    stubApi({ ...SUMMARY, txnCount: 0, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("empty-period")).toBeVisible());
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

  it("draws no Sankey and no table for a period with nothing to show in them", async () => {
    stubApi({ ...SUMMARY, sankey: { sources: [], destinations: [] }, breakdown: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("figure-income")).toBeVisible());
    expect(screen.queryByTestId("sankey-see-transactions")).toBeNull();
    expect(screen.queryByText("Categories")).toBeNull();
  });

  it("says the figures leave out what could not be converted, only when something was", async () => {
    const note = "Excludes transactions in a currency with no exchange rate yet.";
    stubApi(SUMMARY);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("figure-income")).toBeVisible());
    expect(screen.queryByText(note)).toBeNull();
    cleanup();

    stubApi({ ...SUMMARY, fxMissing: true });
    renderPage();
    await waitFor(() => expect(screen.getByText(note)).toBeVisible());
  });

  it("deep-links a category row with the period and the category", async () => {
    renderPage(<FilterProbe />);
    await waitFor(() => expect(screen.getByTestId("breakdown-row-cat:c1")).toBeVisible());
    fireEvent.click(screen.getByTestId("breakdown-row-cat:c1"));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/transactions" });
    const filters = JSON.parse(screen.getByTestId("filters").textContent!);
    expect(filters.categoryIds).toEqual(["c1"]);
    // The period itself, not a label: the chip is worded at render time.
    expect(filters.period).toEqual({ mode: "month", month: currentMonth() });
    expect(filters.from).toBe(`${currentMonth()}-01`);
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
    expect(filters.search).toBe("aldi");
  });

  it("writes the flag and the outflow bucket for the uncategorised row", async () => {
    // `bucket: "out"` is needed too: the flag alone would also match uncategorised income.
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
    // Without a reset, patchFilters' merge would leave both set, which the backend ANDs into an empty list.
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
