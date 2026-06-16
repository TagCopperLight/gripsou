import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldingsCard } from "./HoldingsCard";

const HOLDING = {
  id: "h1", ticker: "AAPL", name: "Apple Inc.", kind: "equity", logo: "#555",
  accountId: "a1", accountName: "Trade Republic", accountColor: "#f0b35b",
  category: "brokerage", categoryLabel: "Brokerage", qty: "60", price: "214.3", invested: "11000",
  value: "12858", gl: "1858", glPct: "0.168", spark: ["200", "214.3"],
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HoldingsCard />
    </QueryClientProvider>,
  );
}

describe("HoldingsCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([HOLDING]), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
  });

  it("renders a holding row from the API", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(screen.getByText(/1 assets/)).toBeInTheDocument();
  });
});
