import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import { SettingsGeneral } from "./General";
import { authValue, renderWithApp } from "../../../test/kit";

const updatePrefsSpy = vi.fn().mockResolvedValue(undefined);

function renderPage() {
  return renderWithApp(
    <I18nextProvider i18n={i18n}>
      <SettingsGeneral />
    </I18nextProvider>,
    { auth: authValue({ updatePrefs: updatePrefsSpy }) },
  );
}

describe("SettingsGeneral auto-save", () => {
  beforeEach(() => updatePrefsSpy.mockClear());

  it("persists a language change via updatePrefs", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Français"));
    await waitFor(() =>
      expect(updatePrefsSpy).toHaveBeenCalledWith({ uiLanguage: "fr" }),
    );
  });

  it("shows a live preview using the shared money formatter", () => {
    renderPage();
    // Default prefs -> space groups, comma decimal, € after.
    expect(screen.getByText("1 234 567,89 €")).toBeInTheDocument();
  });

  it("persists private mode via updatePrefs", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "Private mode" }));
    await waitFor(() =>
      expect(updatePrefsSpy).toHaveBeenCalledWith({ privateMode: true }),
    );
  });
});
