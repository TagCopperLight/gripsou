import { expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";
import { AnnualisedReturnCard } from "./AnnualisedReturnCard";

const DATA = {
  today: "2026-10-08",
  total: { annualised: "0.071", since: "2024-12-08", invested: "1234", received: "0", value: "1589", gain: "355", gainPct: "0.288", excludedHistory: 0, excludedRate: 0 },
  accounts: [],
};

it("in private mode, masks the invested, value and gain amounts behind one eye", () => {
  const auth = { isAuthenticated: true, user: null, isBootstrapping: false, prefs: { ...DEFAULT_PREFS, privateMode: true } } as unknown as AuthValue;
  const { container } = render(
    <AuthContext.Provider value={auth}>
      <AnnualisedReturnCard data={DATA} />
    </AuthContext.Provider>,
  );
  const shown = () => /1\D?234|1\D?589|355/.test(container.textContent ?? "");
  expect(shown()).toBe(false);
  expect(container.textContent).toContain("28,8");
  fireEvent.click(screen.getByRole("button", { name: "Show amount" }));
  expect(container.textContent).toMatch(/1\D?234/);
  expect(container.textContent).toMatch(/1\D?589/);
  expect(container.textContent).toContain("355");
});

it("shows dashes rather than zeros when every holding is left out, and says why", () => {
  const auth = { isAuthenticated: true, user: null, isBootstrapping: false, prefs: DEFAULT_PREFS } as unknown as AuthValue;
  const total = { annualised: null, since: null, invested: "0", received: "0", value: "0", gain: "0", gainPct: "0", excludedHistory: 1, excludedRate: 2 };
  const { container } = render(
    <AuthContext.Provider value={auth}>
      <AnnualisedReturnCard data={{ ...DATA, total }} />
    </AuthContext.Provider>,
  );
  expect(container.textContent).not.toMatch(/0\s?€/);
  expect(screen.getByText(/Excludes 1 holding: its purchase and sale history is incomplete/)).toBeInTheDocument();
  expect(screen.getByText(/Excludes 2 holdings: no exchange rate yet/)).toBeInTheDocument();
});

it("shows a dash for the gain when a sale's rate is missing, not value minus invested", () => {
  const auth = { isAuthenticated: true, user: null, isBootstrapping: false, prefs: DEFAULT_PREFS } as unknown as AuthValue;
  const total = { ...DATA.total, received: null, gain: null, gainPct: null };
  const { container } = render(
    <AuthContext.Provider value={auth}>
      <AnnualisedReturnCard data={{ ...DATA, total }} />
    </AuthContext.Provider>,
  );
  expect(container.textContent).toMatch(/1\D?589/);
  expect(container.textContent).not.toContain("355");
  expect(container.textContent).not.toContain("28,8");
});
