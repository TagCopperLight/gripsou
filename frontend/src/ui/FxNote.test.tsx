import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { NetWorthCard } from "../features/dashboard/NetWorthCard";
import { DistributionCard } from "../features/dashboard/DistributionCard";
import { HoldingsCard } from "../features/dashboard/holdings/HoldingsCard";
import type { Account, Holding, NetWorthResponse } from "../api/wire";
import { setPrefs } from "../lib/prefs";
import { DEFAULT_PREFS } from "../api/wire";
import { renderWithApp, jsonResponse, stubFetch } from "../test/kit";

vi.mock("./EChart", () => ({ default: () => <div data-testid="chart" /> }));

/** Answers each endpoint the cards read. */
function stubApi(routes: Record<string, unknown>) {
  stubFetch(async (url: string) => {
      const path = Object.keys(routes).find((p) => url.includes(p));
      return jsonResponse(path ? routes[path] : []);
    });
}

const netWorth = (fxMissing: boolean): NetWorthResponse => ({
  points: [{ t: 1735689600000, netWorth: "1000", invested: "900" }],
  summary: { netWorth: "1000", invested: "900", gainAbs: "100", gainPct: "0.1", fxMissing },
});

/** An ETF quoted in dollars, with no dollar rate: worth zero in the totals. */
const unconverted = (id: string, name: string): Holding => ({
  id, ticker: id, name, kind: "etf", logo: null,
  accountId: "a1", accountName: "PEA", accountColor: "#6ea8fe", accountType: "pea",
  qty: "10", price: "481.23", currency: "USD", priceCurrency: "USD", accountCurrency: "EUR",
  invested: "4000", investedNative: "4000", value: "0", valueNative: "4812.3",
  gl: "-4000", glPct: "-1", fxMissing: true, spark: null, composition: null,
  unexplainedQty: "0", meanPrice: "400",
});

const account = (fxMissing: boolean): Account => ({
  id: "a1", connectionId: "c1", name: "Brokerage account", typeKey: "pea", color: "#6ea8fe",
  value: "1000", currency: "EUR", valueNative: null, lastSyncAt: null,
  sourceName: "Bank", sourceLogo: null, fxMissing,
});

describe("missing exchange rate", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    setPrefs(DEFAULT_PREFS);
  });

  it("counts the holdings the net worth leaves out", async () => {
    stubApi({
      "/net-worth": netWorth(true),
      "/holdings": [unconverted("ese", "ESE"), unconverted("spy", "SPY")],
    });
    renderWithApp(<NetWorthCard />);
    expect(await screen.findByText("Excludes 2 holdings: no exchange rate yet.")).toBeInTheDocument();
  });

  it("says nothing when every rate resolved", async () => {
    stubApi({ "/net-worth": netWorth(false), "/holdings": [] });
    renderWithApp(<NetWorthCard />);
    expect(await screen.findByText(/1[ ,.]?000/)).toBeInTheDocument();
    expect(screen.queryByText(/Excludes/)).not.toBeInTheDocument();
  });

  it("explains the understated distribution under its card", async () => {
    stubApi({ "/accounts": [account(true)], "/holdings": [unconverted("ese", "ESE")] });
    renderWithApp(<DistributionCard />);
    expect(await screen.findByText("Excludes 1 holding: no exchange rate yet.")).toBeInTheDocument();
  });

  it("shows the holding in its own currency, with no gain or loss", async () => {
    stubApi({ "/holdings": [unconverted("ese", "ESE")] });
    renderWithApp(<HoldingsCard />);
    expect(await screen.findByText("4 812,30 $")).toBeInTheDocument();
    expect(screen.queryByText(/4 000/)).not.toBeInTheDocument();
  });
});
