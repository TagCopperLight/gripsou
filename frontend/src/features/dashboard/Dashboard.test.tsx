import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { Dashboard } from "./Dashboard";
import { renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

vi.mock("./NetWorthCard", () => ({ NetWorthCard: () => <div>net worth</div> }));
vi.mock("./DistributionCard", () => ({ DistributionCard: () => <div>distribution</div> }));
vi.mock("./holdings/HoldingsCard", () => ({ HoldingsCard: () => <div>holdings</div> }));

function stubAccounts(body: unknown, status = 200) {
  stubFetch(async () => jsonResponse(body, status));
}

function renderDashboard() {
  renderWithApp(<Dashboard />);
}

describe("Dashboard", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("leaves only the net worth card when there is no account", async () => {
    stubAccounts([]);
    renderDashboard();
    await waitFor(() => expect(screen.queryByText("distribution")).not.toBeInTheDocument());
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
