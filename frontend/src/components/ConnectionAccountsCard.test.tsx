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
  value: "300",
  currency: "EUR",
  valueNative: null,
  lastSyncAt: null,
  sourceName: "Online Bank",
  sourceLogo: null,
  fxMissing: false,
};

const SAVINGS: Account = { ...ACCOUNT, id: "a2", name: "Livret A", typeKey: "savings", value: "100" };

function group(overrides: Partial<ConnectionGroup> = {}): ConnectionGroup {
  return {
    connectionId: "c1",
    sourceName: "Online Bank",
    sourceLogo: null,
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

  it("shows each account's share of what the accounts own; an overdraft has none and reads red", () => {
    const overdrawn: Account = { ...ACCOUNT, id: "a3", name: "Overdrawn", value: "-50" };
    const tiny: Account = { ...ACCOUNT, id: "a4", name: "Tiny", value: "0.2" };
    render(withClient(
      <ConnectionAccountsCard group={group({ accounts: [ACCOUNT, overdrawn, tiny] })} owned={1000} masked={false} />,
    ));
    expect(screen.getByText(/^30([,.]0)?\s?%$/)).toBeInTheDocument();
    expect(screen.getByText(/^<0[,.]1\s?%$/)).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /Overdrawn/ });
    expect(row).not.toHaveTextContent("%");
    expect(screen.getByText(/-50[,.]00/)).toHaveClass("text-red");
  });

  it("puts the sync window's dot on the bank's logo when its sync failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ providerKey: "powens", providerName: "Powens", connections: [
        { id: "c1", displayName: "Online Bank", status: "error", lastSyncAt: null, lastError: "boom", accounts: [], logo: null },
      ] }]), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
    render(withClient(<ConnectionAccountsCard group={group()} owned={400} masked={false} />));
    expect(await screen.findByTestId("connection-error-dot")).toBeInTheDocument();
  });

  it("opens the edit modal for the clicked row", () => {
    render(withClient(<ConnectionAccountsCard group={group()} owned={400} masked={false} />));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Livret A/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Livret A")).toBeInTheDocument();
  });
});
