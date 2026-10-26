import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { NetWorthCard } from "./NetWorthCard";
import type { NetWorthResponse, ProviderGroup, SyncStatus } from "../api/types";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("./EChart", () => ({ default: () => <div data-testid="chart" /> }));

// What the server sends while the user has no accounts.
const NO_ACCOUNTS: NetWorthResponse = {
  points: [],
  summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false, reportingFxMissing: false },
};

function connections(...statuses: SyncStatus[]): ProviderGroup[] {
  return [{
    providerKey: "powens",
    providerName: "Powens",
    connections: statuses.map((status, i) => ({
      id: `c${i}`, displayName: "Bank", status, lastSyncAt: null, lastError: null, accounts: [], logo: null,
    })),
  }];
}

function stubApi(groups: ProviderGroup[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes("/connections") ? groups : NO_ACCOUNTS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><NetWorthCard /></QueryClientProvider>);
}

describe("NetWorthCard with no accounts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    navigate.mockReset();
  });

  it("asks to connect a bank, with no figure, chart or controls", async () => {
    stubApi([]);
    renderCard();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
    expect(screen.queryByText(/0\s?€/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Max" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });

  it("says the first sync is running, without sending the user away", async () => {
    stubApi(connections("syncing"));
    renderCard();
    expect(await screen.findByText("Syncing in progress")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("points to the connections when a settled connection brought nothing in", async () => {
    stubApi(connections("error"));
    renderCard();
    expect(await screen.findByText("No accounts found")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manage connections" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });
});
