import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useAuth } from "./context";
import { setAuthToken } from "../api/client";
import * as client from "../api/client";
import { DEFAULT_PREFS, getPrefs, setPrefs } from "../lib/prefs";
import i18n from "../i18n";
import { startAuthentication } from "@simplewebauthn/browser";
import { renderWithApp, jsonResponse, stubFetch, requestsTo } from "../test/kit";

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

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
  const fetchMock = stubFetch();
  renderWithApp(<Probe />, { auth: "provider" });
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  expect(requestsTo(fetchMock, "/auth/me")).toHaveLength(0);
});

test("stored token → /auth/me resolves → authenticated", async () => {
  setAuthToken("tok", true);
  stubFetch(async () => jsonResponse({ id: "1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS }));
  renderWithApp(<Probe />, { auth: "provider" });
  await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
});

it("applies prefs from /auth/me to the singleton and i18n on bootstrap", async () => {
  setPrefs(DEFAULT_PREFS);
  setAuthToken("tok", true);
  const user = {
    id: "1", name: "A", email: "a@t.local", role: "admin" as const,
    prefs: { ...DEFAULT_PREFS, uiLanguage: "fr" as const, currency: "USD" },
  };
  stubFetch(async () => jsonResponse(user));
  renderWithApp(<div data-testid="probe" />, { auth: "provider" });
  await waitFor(() => expect(getPrefs().currency).toBe("USD"));
  expect(i18n.language).toBe("fr");
});

test("stored token → /auth/me returns 401 → unauthenticated, token cleared", async () => {
  setAuthToken("expired-tok", true);
  stubFetch(async () => new Response("Unauthorized", { status: 401 }));

  renderWithApp(<Probe />, { auth: "provider" });
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());

  expect(client.getAuthToken()).toBeNull();
});

test("stored token → /auth/me network error → token preserved", async () => {
  setAuthToken("good-tok", true);

  // Simulate a network error
  stubFetch(async () => Promise.reject(new TypeError("Failed to fetch")));

  renderWithApp(<Probe />, { auth: "provider" });
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());

  // Token should NOT be wiped from localStorage.
  expect(client.getAuthToken()).toBe("good-tok");
});

const sessionUser = { id: "1", name: "Ann", email: "a@t.local", role: "admin" as const, prefs: DEFAULT_PREFS };

function Capture({ onAuth }: { onAuth: (a: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onAuth(auth);
  return <div>{auth.isBootstrapping ? "boot" : auth.user ? `in ${auth.user.name}` : "out"}</div>;
}

async function mountAuth() {
  let auth!: ReturnType<typeof useAuth>;
  renderWithApp(<Capture onAuth={(a) => { auth = a; }} />, { auth: "provider" });
  await screen.findByText("out");
  return () => auth;
}

describe("passkeys", () => {
  const options = { challenge: "abc" };
  const credential = { id: "cred" };

  beforeEach(() => {
    vi.mocked(startAuthentication).mockReset();
    vi.mocked(startAuthentication).mockResolvedValue(credential as never);
  });

  it.each([
    [true, "local"],
    [false, "session"],
  ])("loginWithPasskey(remember=%s) posts both steps and stores the token in %sStorage", async (remember, where) => {
    const fetchMock = stubFetch(async (url) =>
      jsonResponse(url.endsWith("/auth/passkey/options") ? { challenge: "ch9", options } : { token: "tok", user: sessionUser }),
    );
    const auth = await mountAuth();
    await act(async () => auth().loginWithPasskey(remember));

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/passkey/options", "/api/auth/passkey"]);
    expect(requestsTo(fetchMock, "/auth/passkey/options")[0]).toEqual({ method: "POST", body: {} });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(requestsTo(fetchMock, "/api/auth/passkey").at(-1)).toEqual({
      method: "POST",
      body: { challenge: "ch9", credential, remember },
    });
    expect(await screen.findByText("in Ann")).toBeInTheDocument();
    expect(client.getAuthToken()).toBe("tok");
    const [kept, other] = where === "local" ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    expect(Object.values(kept)).toContain("tok");
    expect(Object.values(other)).not.toContain("tok");
  });

  it("loginWithPasskey signs nobody in when the browser cancels", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ challenge: "ch9", options }));
    vi.mocked(startAuthentication).mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    const auth = await mountAuth();
    await act(async () => {
      await expect(auth().loginWithPasskey(false)).rejects.toThrow("cancelled");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getAuthToken()).toBeNull();
    expect(screen.getByText("out")).toBeInTheDocument();
  });

  it("verifyLogin posts the code to the verify endpoint", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ token: "tok", user: sessionUser }));
    const auth = await mountAuth();
    await act(async () => auth().verifyLogin("ch1", { totp: "123456" }, true));
    expect(requestsTo(fetchMock, "/auth/login/verify")).toEqual([
      { method: "POST", body: { challenge: "ch1", totp: "123456" } },
    ]);
  });
});
