import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Dashboard } from "./Dashboard";

vi.mock("../components/NetWorthCard", () => ({ NetWorthCard: () => <div>net worth</div> }));
vi.mock("../components/DistributionCard", () => ({ DistributionCard: () => <div>distribution</div> }));
vi.mock("../components/HoldingsCard", () => ({ HoldingsCard: () => <div>holdings</div> }));

function stubAccounts(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>);
}

describe("Dashboard", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("leaves only the net worth card when there is no account", async () => {
    stubAccounts([]);
    renderDashboard();
    await vi.waitFor(() => expect(screen.queryByText("distribution")).not.toBeInTheDocument());
    expect(screen.getByText("net worth")).toBeInTheDocument();
    expect(screen.queryByText("holdings")).not.toBeInTheDocument();
  });

  it("keeps every card while the accounts load or fail, each showing its own state", async () => {
    stubAccounts({ error: "down" }, 500);
    renderDashboard();
    expect(screen.getByText("distribution")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("distribution")).toBeInTheDocument();
    expect(screen.getByText("holdings")).toBeInTheDocument();
  });
});
