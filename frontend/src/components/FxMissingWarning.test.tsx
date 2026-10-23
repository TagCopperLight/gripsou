import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NetWorthCard } from "./NetWorthCard";
import { DistributionCard } from "./DistributionCard";
import type { Account, NetWorthResponse } from "../api/types";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS, setPrefs } from "../lib/prefs";

vi.mock("./EChart", () => ({ default: () => <div data-testid="chart" /> }));

const WARNING = /The exchange rate for this currency is not available yet/;
const REPORTING_WARNING = /The exchange rate to USD is not available yet/;

// NetWorthCard's headline renders PrivateMoney, which reads useAuth() —
// provide a minimal mock context (private mode off) rather than pulling in
// the full AuthProvider bootstrap flow.
const authValue: AuthValue = {
  isAuthenticated: false,
  user: null,
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: async () => null,
  loginWithPasskey: async () => {},
  verifyLogin: async () => {},
  adoptSession: () => {},
  logout: async () => {},
  updateUser: () => {},
  updatePrefs: async () => {},
};

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <AuthContext.Provider value={authValue}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}

function stubJson(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

const netWorth = (
  fxMissing: boolean,
  reportingFxMissing = false,
): NetWorthResponse => ({
  points: [{ t: 1735689600000, netWorth: "1000", invested: "900" }],
  summary: {
    netWorth: "1000",
    invested: "900",
    gainAbs: "100",
    gainPct: "0.1",
    fxMissing,
    reportingFxMissing,
  },
});

const slice = (fxMissing: boolean): Account[] => [
  {
    id: "a1",
    connectionId: "c1",
    name: "Brokerage account",
    typeKey: "pea",
    typeLabel: "PEA",
    color: "#6ea8fe",
    value: "1000",
    lastSyncAt: null,
    sourceName: null,
    sourceLogo: null,
    fxMissing,
  },
];

describe("fx-missing warning", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    setPrefs(DEFAULT_PREFS);
  });

  it("warns next to the headline net-worth figure", async () => {
    stubJson(netWorth(true));
    render(withClient(<NetWorthCard />));
    expect(await screen.findByLabelText(WARNING)).toBeInTheDocument();
  });

  it("stays quiet when every rate resolved", async () => {
    stubJson(netWorth(false));
    render(withClient(<NetWorthCard />));
    // Wait for the card to actually render before asserting an absence.
    expect(await screen.findByText(/1[ ,.]?000/)).toBeInTheDocument();
    expect(screen.queryByLabelText(WARNING)).not.toBeInTheDocument();
  });

  // The two warnings answer different questions: fxMissing means a holding
  // was left out of the sum, reportingFxMissing means the whole sum is in the
  // wrong currency. They must not be collapsed into one message.
  it("says so when the reporting currency has no rate", async () => {
    setPrefs({ ...DEFAULT_PREFS, currency: "USD" });
    stubJson(netWorth(false, true));
    render(withClient(<NetWorthCard />));
    expect(await screen.findByText(REPORTING_WARNING)).toBeInTheDocument();
  });

  it("stays quiet when the reporting currency converts", async () => {
    setPrefs({ ...DEFAULT_PREFS, currency: "USD" });
    stubJson(netWorth(false));
    render(withClient(<NetWorthCard />));
    expect(await screen.findByText(/1[ ,.]?000/)).toBeInTheDocument();
    expect(screen.queryByText(REPORTING_WARNING)).not.toBeInTheDocument();
  });

  it("warns on an understated distribution slice", async () => {
    stubJson(slice(true));
    render(withClient(<DistributionCard />));
    expect(await screen.findByLabelText(WARNING)).toBeInTheDocument();
  });

  it("leaves a fully-valued slice unmarked", async () => {
    stubJson(slice(false));
    render(withClient(<DistributionCard />));
    expect(await screen.findByText("Brokerage account")).toBeInTheDocument();
    expect(screen.queryByLabelText(WARNING)).not.toBeInTheDocument();
  });
});
