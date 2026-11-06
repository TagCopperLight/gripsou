import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NetWorthCard } from "./NetWorthCard";
import type { NetWorthResponse, ProviderGroup, ConnectionStatus } from "../../api/wire";
import { DEFAULT_PREFS } from "../../api/wire";
import { authValue, renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
const chart = vi.hoisted(() => ({ option: null as null | { series: { data: unknown[] }[] } }));
vi.mock("../../ui/EChart", () => ({
  default: (props: { option: typeof chart.option }) => {
    chart.option = props.option;
    return <div data-testid="chart" />;
  },
}));

// What the server sends while the user has no accounts.
const NO_ACCOUNTS: NetWorthResponse = {
  points: [],
  summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false },
};

function connections(...statuses: ConnectionStatus[]): ProviderGroup[] {
  return [{
    providerKey: "powens",
    providerName: "Powens",
    connections: statuses.map((status, i) => ({
      id: `c${i}`, displayName: "Bank", canManage: false, health: null, status, lastSyncAt: null, lastError: null, accounts: [], logo: null,
    })),
  }];
}

function stubApi(groups: ProviderGroup[]) {
  stubFetch(async (url: string) =>
      jsonResponse(String(url).includes("/connections") ? groups : String(url).includes("/holdings") ? [] : NO_ACCOUNTS));
}

function renderCard(prefs = DEFAULT_PREFS) {
  const auth = authValue({ prefs });
  renderWithApp(<NetWorthCard />, { auth });
}

describe("NetWorthCard with no accounts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    navigate.mockReset();
  });

  it("asks to connect a bank, with no figure, chart or controls", async () => {
    stubApi([]);
    renderCard();
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
    expect(screen.queryByText(/0\s?€/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Max" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });

  it("says the first sync is running, without sending the user away", async () => {
    stubApi(connections("syncing"));
    renderCard();
    expect(await screen.findByText("Syncing in progress")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("points to the connections when a settled connection brought nothing in", async () => {
    stubApi(connections("error"));
    renderCard();
    expect(await screen.findByText("No accounts found")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manage connections" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });
});

describe("NetWorthCard with a day the reader's currency has no rate", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("leaves a gap there instead of plotting zero", async () => {
    const body: NetWorthResponse = {
      points: [{ t: 0, netWorth: null, invested: null }, { t: 1, netWorth: "100", invested: "90" }],
      summary: { netWorth: "100", invested: "90", gainAbs: "0", gainPct: "0", fxMissing: false },
    };
    stubFetch(async (url: string) => Response.json(String(url).includes("/holdings") ? [] : body));
    renderCard();

    await screen.findByTestId("chart");
    expect(chart.option?.series.map((s) => s.data)).toEqual([
      [[0, null], [1, 90]],
      [[0, null], [1, 100]],
    ]);
  });
});

describe("NetWorthCard in private mode", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("masks the gain with the headline, keeps the percentage, and one eye reveals both", async () => {
    const body: NetWorthResponse = {
      points: [{ t: 0, netWorth: "10000", invested: "9000" }, { t: 1, netWorth: "11234.56", invested: "9000" }],
      summary: { netWorth: "11234.56", invested: "9000", gainAbs: "1234.56", gainPct: "0.1235", fxMissing: false },
    };
    stubFetch(async (url: string) => Response.json(String(url).includes("/holdings") ? [] : body));
    renderCard({ ...DEFAULT_PREFS, privateMode: true });

    expect(await screen.findByText(/12,35\s?%/)).toBeInTheDocument();
    expect(screen.queryByText(/234,56/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show amount" }));
    expect(screen.getByText(/11\s?234,56/)).toBeInTheDocument();
    expect(screen.getByText(/\+\s?1\s?234,56/)).toBeInTheDocument();
  });
});
