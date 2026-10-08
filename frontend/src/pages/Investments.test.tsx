import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";
vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="chart" /> }));

import { Investments } from "./Investments";

const AUTH = {
  isAuthenticated: true,
  user: null,
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
} as unknown as AuthValue;

const RETURNS = {
  today: "2026-10-08",
  total: { annualised: "0.071", since: "2024-12-08", invested: "100", value: "110", gl: "10", glPct: "0.1" },
  accounts: [
    {
      id: "a1", name: "Example PEA", color: "#5b9bf0", source: "Example Bank",
      missing: [{ id: "h9", name: "Example Corp" }],
      annualised: "0.084", since: "2024-12-08", invested: "100", value: "110", gl: "10", glPct: "0.1",
    },
  ],
};

const FUND = {
  id: "h1", instrumentId: "i1", ticker: "WLD", name: "Example World ETF", kind: "etf", logo: null,
  accountId: "a1", accountName: "Example PEA", accountColor: "#5b9bf0", accountType: "pea",
  accountTypeLabel: "PEA", qty: "1", price: "110", currency: "EUR", priceCurrency: "EUR",
  accountCurrency: "EUR", invested: "100", investedNative: "100", value: "110", gl: "10",
  glPct: "0.1", fxMissing: false, spark: null, unexplainedQty: "0", meanPrice: "100",
  unexplainedCost: "0",
  composition: { countries: [{ name: "Etats-Unis", weight: 1 }], sectors: [{ name: "Technologie", weight: 1 }] },
};

const CASH = { ...FUND, id: "c1", instrumentId: "i0", ticker: "EUR", name: "Euro", kind: "cash", composition: null };

function renderPage(routes: Record<string, unknown> | "down") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (routes === "down") return new Response("", { status: 503 });
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      return new Response(JSON.stringify(key ? routes[key] : null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return render(
    <AuthContext.Provider value={AUTH}>
      <QueryClientProvider client={client}>
        <Investments />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Investments page", () => {
  it("shows the returns and the exposure from the API", async () => {
    renderPage({ "/investments/returns": RETURNS, "/holdings": [FUND, CASH] });
    await waitFor(() => expect(screen.getByText("Example PEA")).toBeInTheDocument());
    expect(screen.getByText("Example Bank")).toBeInTheDocument();
    expect(screen.getByText("Example World ETF")).toBeInTheDocument();
    expect(screen.queryByText("Euro")).not.toBeInTheDocument();
  });

  it("says no purchases are recorded when the account has no return and no first purchase", async () => {
    const account = { ...RETURNS.accounts[0], annualised: null, since: null };
    renderPage({ "/investments/returns": { ...RETURNS, accounts: [account] }, "/holdings": [FUND, CASH] });
    await waitFor(() => expect(screen.getByText("Example PEA")).toBeInTheDocument());
    expect(screen.getByText("no purchases recorded")).toBeInTheDocument();
  });

  it("leaves the label out when purchases exist but the return can't be computed", async () => {
    const account = { ...RETURNS.accounts[0], annualised: null };
    renderPage({ "/investments/returns": { ...RETURNS, accounts: [account] }, "/holdings": [FUND, CASH] });
    await waitFor(() => expect(screen.getByText("Example PEA")).toBeInTheDocument());
    expect(screen.queryByText("no purchases recorded")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing but cash is held", async () => {
    renderPage({
      "/investments/returns": { ...RETURNS, accounts: [] },
      "/holdings": [CASH],
    });
    await waitFor(() => expect(screen.getByText("No investments yet")).toBeInTheDocument());
  });

  it("says so when the server can't be reached", async () => {
    renderPage("down");
    await waitFor(() => expect(screen.getAllByText("Can't reach the server").length).toBeGreaterThan(0));
  });
});
