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
    prefs: { ...DEFAULT_PREFS, currency: "GBP" },
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

test("a currency the server can't get a rate for is refused and the old one stays", async () => {
  const user = {
    id: "1",
    name: "A",
    email: "a@t.local",
    role: "admin" as const,
    prefs: { ...DEFAULT_PREFS, currency: "GBP" },
  };
  vi.spyOn(client, "getJson").mockResolvedValue(user);
  vi.spyOn(client, "patchJson").mockRejectedValue(new client.ApiError("no rate", 502));

  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <SettingsGeneral />
      </AuthProvider>
    </I18nextProvider>,
  );
  await screen.findByText("1 234 567,89 £");

  fireEvent.click(screen.getByText("GBP (£)"));
  fireEvent.click(screen.getByText("USD ($)"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get the USD rate. Try again later.");
  expect(screen.getByText("GBP (£)")).toBeInTheDocument();
  expect(screen.getByText("1 234 567,89 £")).toBeInTheDocument();
});

test("a setting the server failed to save says so and goes back", async () => {
  const user = { id: "1", name: "A", email: "a@t.local", role: "admin" as const, prefs: DEFAULT_PREFS };
  vi.spyOn(client, "getJson").mockResolvedValue(user);
  vi.spyOn(client, "patchJson").mockRejectedValue(new client.ApiError("boom", 500));

  render(
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <SettingsGeneral />
      </AuthProvider>
    </I18nextProvider>,
  );
  fireEvent.click(await screen.findByText("English"));
  fireEvent.click(screen.getByText("Français"));

  expect(await screen.findByTestId("error-toast")).toHaveTextContent("Couldn't save the setting");
  expect(screen.getByText("English")).toBeInTheDocument();
});
