import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccountCard } from "./AccountCard";
import type { Account } from "../api/types";

const ACCOUNT: Account = {
  id: "a1",
  name: "Compte Courant",
  color: "#6ea8fe",
  typeKey: "checking",
  typeLabel: "Checking",
  value: "12480.30",
  lastSyncAt: null,
  sourceName: "BoursoBank",
  sourceLogo: null,
  fxMissing: false,
};

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("AccountCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("renders name, type label, proportion and sync state", () => {
    render(withClient(<AccountCard account={ACCOUNT} proportion={0.142} />));
    expect(screen.getByText("Compte Courant")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText(/14[.,]2/)).toBeInTheDocument();
    expect(screen.getByText("Never synced")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("BoursoBank")).toBeInTheDocument();
  });

  it("opens the edit modal when the edit button is clicked", () => {
    render(withClient(<AccountCard account={ACCOUNT} proportion={0.142} />));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit account" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit account")).toBeInTheDocument();
  });
});
