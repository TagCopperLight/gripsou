import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AccountsChartCard } from "./AccountsChartCard";
import type { NetWorthResponse } from "../api/types";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./EChart", () => ({ default: () => <div data-testid="chart" /> }));

// What the server sends while the user has no accounts.
const NO_ACCOUNTS: NetWorthResponse = {
  points: [],
  summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false },
};

describe("AccountsChartCard with no accounts", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("asks to connect a bank instead of showing a 0 € figure and a gain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        const body = u.includes("/connections") ? [] : u.includes("/accounts/series") ? { accounts: [], points: [] } : NO_ACCOUNTS;
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={{ prefs: DEFAULT_PREFS } as unknown as AuthValue}><AccountsChartCard /></AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByText(/0\s?€/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Max" })).not.toBeInTheDocument();
  });
});
