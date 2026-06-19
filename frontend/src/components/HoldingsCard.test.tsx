import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldingsCard } from "./HoldingsCard";

const HOLDING = {
  id: "h1", ticker: "AAPL", name: "Apple Inc.", kind: "equity", logo: "#555",
  accountId: "a1", accountName: "Trade Republic", accountColor: "#f0b35b",
  category: "brokerage", categoryLabel: "Brokerage", qty: "60", price: "214.3", invested: "11000",
  value: "12858", gl: "1858", glPct: "0.168", spark: ["200", "214.3"],
};

const CASH_CHECKING = {
  id: "c1", ticker: "EUR", name: "Euro", kind: "cash", logo: "#888",
  accountId: "a1", accountName: "Checking", accountColor: "#888",
  category: "cash", categoryLabel: "Cash", qty: "100", price: "1", invested: "100",
  value: "100", gl: "0", glPct: "0", spark: null,
};

const CASH_PEA = {
  ...CASH_CHECKING, id: "c2", accountId: "a2", accountName: "PEA", qty: "200", invested: "200", value: "200",
};

function renderCard(holdings: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(holdings), { status: 200, headers: { "Content-Type": "application/json" } }),
  ));
  return render(
    <QueryClientProvider client={client}>
      <HoldingsCard />
    </QueryClientProvider>,
  );
}

describe("HoldingsCard", () => {
  it("renders a holding row from the API", async () => {
    renderCard([HOLDING]);
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText(/1 assets/)).toBeInTheDocument();
  });

  it("merges same-currency cash across accounts into one row", async () => {
    renderCard([HOLDING, CASH_CHECKING, CASH_PEA]);
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    // Two cash holdings collapse into one → 1 equity + 1 cash = 2 assets.
    expect(screen.getByText(/2 assets/)).toBeInTheDocument();
    expect(screen.getByText("Multiple accounts")).toBeInTheDocument();
    // The individual cash account names are no longer shown as separate rows.
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
    expect(screen.queryByText("PEA")).not.toBeInTheDocument();
  });
});
