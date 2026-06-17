import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import { AuthProvider } from "../../auth/AuthProvider";
import * as client from "../../api/client";
import { DEFAULT_PREFS, setPrefs } from "../../lib/prefs";
import { SettingsGeneral } from "./General";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  client.setAuthToken("tok", true);
  setPrefs(DEFAULT_PREFS);
  vi.restoreAllMocks();
});

test("preview updates live (no refresh) when prefs change", async () => {
  // Bootstrap a logged-in user with a DISTINCT currency (£) so we can confirm
  // the user is authenticated before interacting (mirrors the real app, where
  // the settings page is only reached while logged in).
  const user = {
    id: "1",
    name: "A",
    email: "a@t.local",
    role: "admin" as const,
    prefs: { ...DEFAULT_PREFS, currencySymbol: "£" },
  };
  vi.spyOn(client, "getJson").mockResolvedValue(user);
  // PATCH echoes back the sent prefs, like the real backend.
  vi.spyOn(client, "patchJson").mockImplementation(
    async (_path: string, body: unknown) => ({ ...user, prefs: body }),
  );

  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <SettingsGeneral />
      </AuthProvider>
    </I18nextProvider>,
  );

  // Bootstrap applied the user's £ prefs — preview reflects it.
  await screen.findByText("1 234 567,89 £");

  // Change currency GBP -> USD via the custom Select.
  fireEvent.click(screen.getByText("GBP (£)"));
  fireEvent.click(screen.getByText("USD ($)"));

  // Preview must reflect the new symbol live, without a remount/refresh.
  await waitFor(() =>
    expect(screen.getByText("1 234 567,89 $")).toBeInTheDocument(),
  );
});
