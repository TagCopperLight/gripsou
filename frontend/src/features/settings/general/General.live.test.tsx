import { beforeEach, expect, test, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../../i18n";
import * as client from "../../../api/client";
import { setPrefs } from "../../../lib/prefs";
import { DEFAULT_PREFS } from "../../../api/wire";
import { SettingsGeneral } from "./General";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

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
  // PATCH echoes back the sent prefs, like the real backend.
  stubFetch(async (url, init) =>
    jsonResponse(url.endsWith("/auth/prefs") ? { ...user, prefs: JSON.parse(String(init?.body)) } : user),
  );

  renderWithApp(<I18nextProvider i18n={i18n}><SettingsGeneral /></I18nextProvider>, { auth: "provider" });

  // Bootstrap applied the user's £ prefs — preview reflects it.
  await screen.findByText("1 234 567,89 £");

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
  stubFetch(async (url) => (url.endsWith("/auth/prefs") ? new Response("no rate", { status: 502 }) : jsonResponse(user)));

  renderWithApp(<I18nextProvider i18n={i18n}><SettingsGeneral /></I18nextProvider>, { auth: "provider" });
  await screen.findByText("1 234 567,89 £");

  fireEvent.click(screen.getByText("GBP (£)"));
  fireEvent.click(screen.getByText("USD ($)"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get the USD rate. Try again later.");
  expect(screen.getByText("GBP (£)")).toBeInTheDocument();
  expect(screen.getByText("1 234 567,89 £")).toBeInTheDocument();
});

test("a setting the server failed to save says so and goes back", async () => {
  const user = { id: "1", name: "A", email: "a@t.local", role: "admin" as const, prefs: DEFAULT_PREFS };
  stubFetch(async (url) => (url.endsWith("/auth/prefs") ? new Response("boom", { status: 500 }) : jsonResponse(user)));

  renderWithApp(<I18nextProvider i18n={i18n}><SettingsGeneral /></I18nextProvider>, { auth: "provider" });
  fireEvent.click(await screen.findByText("English"));
  fireEvent.click(screen.getByText("Français"));

  expect(await screen.findByTestId("error-toast")).toHaveTextContent("Couldn't save the setting");
  expect(screen.getByText("English")).toBeInTheDocument();
});
