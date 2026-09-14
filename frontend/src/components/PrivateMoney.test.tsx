import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS, type UserPrefs } from "../lib/prefs";
import { formatMoney } from "../lib/money";
import { PrivateMoney } from "./PrivateMoney";

function renderWith(prefs: UserPrefs) {
  const authValue: AuthValue = {
    isAuthenticated: true,
    user: { id: "1", name: "A", email: "a@t.local", role: "user", prefs },
    isBootstrapping: false,
    prefs,
    login: async () => {},
    adoptSession: () => {},
    logout: async () => {},
    updateUser: () => {},
    updatePrefs: async () => {},
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <AuthContext.Provider value={authValue}>
        <PrivateMoney value="1234.5" />
      </AuthContext.Provider>
    </I18nextProvider>,
  );
}

// The mask is one asterisk per character of the formatted amount, so it stays
// exactly as wide as the figure it hides.
const MASK = "*".repeat(formatMoney("1234.5").length);

describe("PrivateMoney", () => {
  it("renders the amount and no eye button when private mode is off", () => {
    renderWith(DEFAULT_PREFS);
    expect(screen.getByText(/234/)).toBeInTheDocument();
    expect(screen.queryByText(MASK)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("masks the amount when private mode is on", () => {
    renderWith({ ...DEFAULT_PREFS, privateMode: true });
    expect(screen.getByText(MASK)).toBeInTheDocument();
    expect(screen.queryByText(/234/)).not.toBeInTheDocument();
  });

  it("reveals the amount when the eye button is clicked, and hides it again", () => {
    renderWith({ ...DEFAULT_PREFS, privateMode: true });
    fireEvent.click(screen.getByRole("button", { name: "Show amount" }));
    expect(screen.getByText(/234/)).toBeInTheDocument();
    expect(screen.queryByText(MASK)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide amount" }));
    expect(screen.getByText(MASK)).toBeInTheDocument();
  });
});
