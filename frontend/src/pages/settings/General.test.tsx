import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";
import { SettingsGeneral } from "./General";

const updatePrefsSpy = vi.fn().mockResolvedValue(undefined);

const authValue: AuthValue = {
  isAuthenticated: true,
  user: { id: "1", name: "A", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS },
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: async () => {},
  logout: async () => {},
  updateUser: () => {},
  updatePrefs: updatePrefsSpy,
};

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AuthContext.Provider value={authValue}>
        <SettingsGeneral />
      </AuthContext.Provider>
    </I18nextProvider>,
  );
}

describe("SettingsGeneral auto-save", () => {
  beforeEach(() => updatePrefsSpy.mockClear());

  it("persists a language change via updatePrefs", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Français"));
    await waitFor(() =>
      expect(updatePrefsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ uiLanguage: "fr" }),
      ),
    );
  });

  it("shows a live preview using the shared money formatter", () => {
    renderPage();
    // Default prefs -> space groups, comma decimal, € after.
    expect(screen.getByText("1 234 567,89 €")).toBeInTheDocument();
  });
});
