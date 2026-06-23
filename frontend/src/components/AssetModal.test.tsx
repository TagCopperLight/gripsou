import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetModal } from "./AssetModal";
import type { Holding } from "../api/types";

const BASE: Holding = {
  id: "h1", ticker: "PUST", name: "Amundi Nasdaq", kind: "etf", logo: null,
  accountId: "a1", accountName: "PEA", accountColor: "#6ea8fe",
  category: "pea", categoryLabel: "PEA", qty: "10", price: "100",
  invested: "800", value: "1000", gl: "200", glPct: "0.25", spark: null,
  composition: { countries: [{ name: "United States", weight: 0.62 }], sectors: [] },
};

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("AssetModal composition surface", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("shows the composition surface for an ETF with composition", () => {
    render(withClient(<AssetModal holding={BASE} netWorth={5000} onClose={() => {}} />));
    expect(screen.getByText("Country distribution")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("hides the surface when composition is null", () => {
    render(withClient(
      <AssetModal holding={{ ...BASE, composition: null }} netWorth={5000} onClose={() => {}} />,
    ));
    expect(screen.queryByText("Country distribution")).not.toBeInTheDocument();
  });
});
