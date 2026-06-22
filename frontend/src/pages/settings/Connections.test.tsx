import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsConnections } from "./Connections";
import type { ProviderGroup } from "../../api/types";

const GROUPS: ProviderGroup[] = [
  {
    providerKey: "powens",
    providerName: "Powens",
    connections: [
      {
        id: "c1",
        displayName: "Boursorama",
        status: "ok",
        lastSyncAt: 1_700_000_000_000,
        lastError: null,
        accounts: [
          { id: "a1", name: "Compte courant", color: "#3b82f6", typeLabel: "Checking", value: "1234.50", lastSyncAt: 1_700_000_000_000 },
          { id: "a2", name: "Livret A", color: null, typeLabel: "Savings", value: "8000.00", lastSyncAt: 1_700_000_000_000 },
        ],
      },
      {
        id: "c2",
        displayName: "Trade Republic",
        status: "error",
        lastSyncAt: null,
        lastError: "Credentials expired",
        accounts: [],
      },
    ],
  },
];

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SettingsConnections", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(GROUPS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("shows an error state with retry when the fetch fails", async () => {
    // isLoading is false once a query errors, so the error branch must not be
    // nested under isLoading — otherwise an API failure shows the empty state.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ));
    render(withClient(<SettingsConnections />));
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows the connection + account counts in the header", async () => {
    render(withClient(<SettingsConnections />));
    await screen.findByText("Boursorama");
    // Scope to the heading: the per-connection row subtitle also says "2 accounts".
    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent(/2 connections/);
    expect(heading).toHaveTextContent(/2 accounts/);
  });

  it("renders a card per connection with status tags", async () => {
    render(withClient(<SettingsConnections />));
    await screen.findByText("Boursorama");
    expect(screen.getByText("Trade Republic")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Credentials expired")).toBeInTheDocument();
  });

  it("expands a connection to reveal its accounts", async () => {
    render(withClient(<SettingsConnections />));
    const header = await screen.findByText("Boursorama");
    expect(screen.queryByText("Compte courant")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("Compte courant")).toBeInTheDocument();
    expect(screen.getByText("Livret A")).toBeInTheDocument();
  });
});
