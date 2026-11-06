import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { AccountsChartCard } from "./AccountsChartCard";
import type { NetWorthResponse } from "../../api/types";
import { renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../ui/EChart", () => ({ default: () => <div data-testid="chart" /> }));

// What the server sends while the user has no accounts.
const NO_ACCOUNTS: NetWorthResponse = {
  points: [],
  summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false },
};

describe("AccountsChartCard with no accounts", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("asks to connect a bank instead of showing a 0 € figure and a gain", async () => {
    stubFetch(async (url: string) => {
        const u = String(url);
        const body = u.includes("/connections") || u.includes("/holdings") ? [] : u.includes("/accounts/series") ? { accounts: [], points: [] } : NO_ACCOUNTS;
        return jsonResponse(body);
      });
    renderWithApp(<AccountsChartCard />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByText(/0\s?€/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Max" })).not.toBeInTheDocument();
  });
});
