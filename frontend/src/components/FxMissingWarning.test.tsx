import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NetWorthCard } from "./NetWorthCard";
import { DistributionCard } from "./DistributionCard";
import type { DistributionAccount, NetWorthResponse } from "../api/types";

vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="chart" /> }));

const WARNING = /No exchange rate yet/;

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stubJson(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

const netWorth = (fxMissing: boolean): NetWorthResponse => ({
  points: [{ t: 1735689600000, netWorth: "1000", invested: "900" }],
  summary: {
    netWorth: "1000",
    invested: "900",
    gainAbs: "100",
    gainPct: "0.1",
    fxMissing,
  },
});

const slice = (fxMissing: boolean): DistributionAccount[] => [
  {
    id: "a1",
    name: "Brokerage account",
    accountType: "pea",
    accountTypeLabel: "PEA",
    color: "#6ea8fe",
    value: "1000",
    fxMissing,
  },
];

describe("fx-missing warning", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("warns next to the headline net-worth figure", async () => {
    stubJson(netWorth(true));
    render(withClient(<NetWorthCard />));
    expect(await screen.findByLabelText(WARNING)).toBeInTheDocument();
  });

  it("stays quiet when every rate resolved", async () => {
    stubJson(netWorth(false));
    render(withClient(<NetWorthCard />));
    // Wait for the card to actually render before asserting an absence.
    expect(await screen.findByText(/1[ ,.]?000/)).toBeInTheDocument();
    expect(screen.queryByLabelText(WARNING)).not.toBeInTheDocument();
  });

  it("warns on an understated distribution slice", async () => {
    stubJson(slice(true));
    render(withClient(<DistributionCard />));
    expect(await screen.findByLabelText(WARNING)).toBeInTheDocument();
  });

  it("leaves a fully-valued slice unmarked", async () => {
    stubJson(slice(false));
    render(withClient(<DistributionCard />));
    expect(await screen.findByText("Brokerage account")).toBeInTheDocument();
    expect(screen.queryByLabelText(WARNING)).not.toBeInTheDocument();
  });
});
