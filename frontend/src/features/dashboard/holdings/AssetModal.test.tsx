import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetModal } from "./AssetModal";
import type { Holding } from "../../../api/wire";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

// Real echarts crashes in jsdom's canvas stub when a mode switch re-renders the chart.
vi.mock("../../../ui/EChart", () => ({ default: () => <div data-testid="chart" /> }));

const BASE: Holding = {
  id: "h1", ticker: "PUST", name: "Amundi Nasdaq", kind: "etf", logo: null,
  accountId: "a1", accountName: "PEA", accountColor: "#6ea8fe",
  accountType: "pea", qty: "10", price: "100", currency: "EUR",
  priceCurrency: "EUR", accountCurrency: "EUR",
  invested: "800", investedNative: "800", value: "1000", gl: "200", glPct: "0.25",
  valueNative: "1000", fxMissing: false, spark: null,
  composition: { countries: [{ name: "United States", weight: 0.62 }], sectors: [] },
  unexplainedQty: "0",
  meanPrice: "80",
};


// The instrument is quoted in EUR, its price rows come from a GBP listing and it sits in a USD account: the unit price must read GBP, the mean price per share USD.
describe("AssetModal currency domains", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse([]));
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
    renderWithApp(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />);
    expect(screen.getByText("100,00 £")).toBeInTheDocument();
  });

  it("labels mean price per share with the account's currency", () => {
    renderWithApp(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />);
    expect(screen.getByText("80,00 $")).toBeInTheDocument();
  });

  it("never labels anything with the instrument's quote currency", () => {
    renderWithApp(<AssetModal holding={MIXED} netWorth={5000} onClose={() => {}} />);
    // EUR is also the reporting currency, so it may appear only on reporting-domain figures.
    expect(screen.queryByText("100,00 €")).not.toBeInTheDocument();
    expect(screen.queryByText("80,00 €")).not.toBeInTheDocument();
  });
});

describe("AssetModal purchases chart", () => {
  // A GBP quote in a USD account: the purchases chart values the position at the account-currency price.
  it("reads in the account's currency", async () => {
    stubFetch(async (url: string) =>
      jsonResponse(url.includes("/prices") ? [{ t: 1, price: "100", accountPrice: "120", qty: "10", invested: "800" }] : []));
    const user = userEvent.setup();
    renderWithApp(<AssetModal
        holding={{ ...BASE, priceCurrency: "GBP", accountCurrency: "USD" }}
        netWorth={5000}
        onClose={() => {}}
      />);
    await user.click(screen.getByRole("radio", { name: /purchases/i }));
    expect(await screen.findByText(/^1.200,00.\$$/)).toBeInTheDocument();
  });
});

describe("AssetModal purchases gain", () => {
  // Five shares on day 1, five more on day 2, flat price: the value doubles only because money went in.
  it("does not count a purchase as a gain", async () => {
    stubFetch(async (url: string) =>
      jsonResponse(url.includes("/prices")
          ? [
              { t: 1, price: "100", accountPrice: "100", qty: "5", invested: "500" },
              { t: 2, price: "100", accountPrice: "100", qty: "10", invested: "1000" },
            ]
          : []));
    const user = userEvent.setup();
    renderWithApp(<AssetModal holding={BASE} netWorth={5000} onClose={() => {}} />);
    await user.click(screen.getByRole("radio", { name: /purchases/i }));
    expect(await screen.findByText(/^\+?0,00.€$/)).toBeInTheDocument();
    expect(screen.queryByText(/^\+500,00.€$/)).not.toBeInTheDocument();
  });
});

describe("incomplete-history strip", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse([]));
  });

  it("offers to record the history, in both modes", async () => {
    const user = userEvent.setup();
    const onRecordLots = vi.fn();
    renderWithApp(<AssetModal
        holding={{ ...BASE, unexplainedQty: "5" }}
        netWorth={1000}
        onClose={vi.fn()}
        onRecordLots={onRecordLots}
      />);
    expect(screen.getByText(/^incomplete history$/i)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /purchases/i }));
    expect(screen.getByText(/^incomplete history$/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /record buy\/sell history/i }));
    expect(onRecordLots).toHaveBeenCalled();
  });

  it("stays out of the way when the history is complete", () => {
    renderWithApp(<AssetModal
        holding={{ ...BASE, unexplainedQty: "0" }}
        netWorth={1000}
        onClose={vi.fn()}
        onRecordLots={vi.fn()}
      />);
    expect(screen.queryByText(/^incomplete history$/i)).not.toBeInTheDocument();
  });
});
