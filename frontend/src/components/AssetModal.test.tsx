import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetModal } from "./AssetModal";
import type { Holding } from "../api/types";

const BASE: Holding = {
  id: "h1", ticker: "PUST", name: "Amundi Nasdaq", kind: "etf", logo: null,
  accountId: "a1", accountName: "PEA", accountColor: "#6ea8fe",
  accountType: "pea", accountTypeLabel: "PEA", qty: "10", price: "100", currency: "EUR",
  priceCurrency: "EUR", accountCurrency: "EUR",
  invested: "800", investedNative: "800", value: "1000", gl: "200", glPct: "0.25",
  fxMissing: false, spark: null,
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

// The three domains must not be collapsed. Here they are deliberately all
// different: the instrument is quoted in EUR (Powens' label), its price rows
// come from a GBP listing, and it sits in a USD account. The unit price is
// GBP-labelled; mean price per share — investedNative / qty, a cost-basis
// figure — is USD-labelled. Labelling either with `holding.currency` (EUR), as
// the code used to, silently misreports both.
describe("AssetModal currency domains", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  const MIXED: Holding = {
    ...BASE,
    currency: "EUR",
    priceCurrency: "GBP",
    accountCurrency: "USD",
    price: "100",
    qty: "10",
    investedNative: "800",
  };

  it("labels the unit price with the price row's currency, not the instrument's", () => {
    render(withClient(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />));
    // headerValue = holding.price = 100, formatted in the price domain (GBP),
    // NOT in holding.currency (EUR).
    expect(screen.getByText("100,00 £")).toBeInTheDocument();
  });

  it("labels mean price per share with the account's currency", () => {
    render(withClient(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />));
    // investedNative 800 / qty 10 = 80, an amount-domain figure -> USD.
    expect(screen.getByText("80,00 $")).toBeInTheDocument();
  });

  it("never labels anything with the instrument's quote currency", () => {
    render(withClient(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />));
    // EUR is both the instrument's quote currency and (by default prefs) the
    // reporting currency, so it does appear — but only on reporting-domain
    // figures. Nothing on the price or amount side may carry it.
    expect(screen.queryByText("100,00 €")).not.toBeInTheDocument();
    expect(screen.queryByText("80,00 €")).not.toBeInTheDocument();
  });
});
