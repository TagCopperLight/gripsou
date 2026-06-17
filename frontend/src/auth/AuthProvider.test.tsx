import { beforeEach, expect, it, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";
import { setAuthToken } from "../api/client";
import * as client from "../api/client";
import { DEFAULT_PREFS, getPrefs, setPrefs } from "../lib/prefs";
import i18n from "../i18n";

function Probe() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  return <div>{isBootstrapping ? "boot" : isAuthenticated ? "in" : "out"}</div>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setAuthToken(null);
  vi.restoreAllMocks();
});

test("no token → unauthenticated, no /auth/me call", async () => {
  const spy = vi.spyOn(client, "getJson");
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  expect(spy).not.toHaveBeenCalled();
});

test("stored token → /auth/me resolves → authenticated", async () => {
  setAuthToken("tok", true);
  vi.spyOn(client, "getJson").mockResolvedValue({
    id: "1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS,
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
});

it("applies prefs from /auth/me to the singleton and i18n on bootstrap", async () => {
  setPrefs(DEFAULT_PREFS);
  setAuthToken("tok", true);
  const user = {
    id: "1", name: "A", email: "a@t.local", role: "admin" as const,
    prefs: { ...DEFAULT_PREFS, uiLanguage: "fr" as const, currencySymbol: "$" },
  };
  vi.spyOn(client, "getJson").mockResolvedValue(user);
  render(<AuthProvider><div data-testid="probe" /></AuthProvider>);
  await waitFor(() => expect(getPrefs().currencySymbol).toBe("$"));
  expect(i18n.language).toBe("fr");
});

test("stored token → /auth/me returns 401 → unauthenticated, global handler NOT called", async () => {
  setAuthToken("expired-tok", true);

  // Register a global unauthorized handler spy — it must NOT be called.
  const unauthorizedSpy = vi.fn();
  client.setUnauthorizedHandler(unauthorizedSpy);

  // Simulate the real fetch path: getJson with skipGlobalUnauthorized = true
  // means the 401 should never reach the global handler.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unauthorized", { status: 401 })),
  );

  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());

  // Global handler must not have been triggered (no spurious POST /auth/logout).
  expect(unauthorizedSpy).not.toHaveBeenCalled();
});
