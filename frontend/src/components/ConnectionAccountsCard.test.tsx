import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConnectionAccountsCard } from "./ConnectionAccountsCard";
import type { ConnectionGroup } from "../lib/accounts";
import type { Account } from "../api/types";

const ACCOUNT: Account = {
  id: "a1",
  connectionId: "c1",
  name: "Compte Courant",
  color: "#6ea8fe",
  typeKey: "checking",
  typeLabel: "Checking",
  value: "300",
  lastSyncAt: null,
  sourceName: "Online Bank",
  sourceLogo: null,
  fxMissing: false,
};

const SAVINGS: Account = { ...ACCOUNT, id: "a2", name: "Livret A", typeKey: "savings", typeLabel: "Savings", value: "100" };

function group(overrides: Partial<ConnectionGroup> = {}): ConnectionGroup {
  return {
    connectionId: "c1",
    sourceName: "Online Bank",
    sourceLogo: null,
    lastSyncAt: null,
    total: 400,
    accounts: [ACCOUNT, SAVINGS],
    ...overrides,
  };
}

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("ConnectionAccountsCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("shows the bank, its sync time and a row per account", () => {
    render(withClient(
      <ConnectionAccountsCard
        group={group({ lastSyncAt: Date.now() - 5 * 60_000 })}
        netWorth={1000}
      />,
    ));
    expect(screen.getByText("Online Bank")).toBeInTheDocument();
    expect(screen.getByText("synced 5 min ago")).toBeInTheDocument();
    expect(screen.getByText("Compte Courant")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    // Share of the 1000 net worth, next to each row's bar.
    expect(screen.getByText(/^30\s?%$/)).toBeInTheDocument();
    expect(screen.getByText(/^10\s?%$/)).toBeInTheDocument();
  });

  it("says when the connection never synced", () => {
    render(withClient(<ConnectionAccountsCard group={group()} netWorth={400} />));
    expect(screen.getByText("Never synced")).toBeInTheDocument();
  });

  it("opens the edit modal for the clicked row", () => {
    render(withClient(<ConnectionAccountsCard group={group()} netWorth={400} />));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Livret A/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Livret A")).toBeInTheDocument();
  });
});
