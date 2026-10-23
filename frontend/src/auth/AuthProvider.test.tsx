import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";
import { setAuthToken } from "../api/client";
import * as client from "../api/client";
import { DEFAULT_PREFS, getPrefs, setPrefs } from "../lib/prefs";
import i18n from "../i18n";
import { startAuthentication } from "@simplewebauthn/browser";

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
    prefs: { ...DEFAULT_PREFS, uiLanguage: "fr" as const, currency: "USD" },
  };
  vi.spyOn(client, "getJson").mockResolvedValue(user);
  render(<AuthProvider><div data-testid="probe" /></AuthProvider>);
  await waitFor(() => expect(getPrefs().currency).toBe("USD"));
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

test("stored token → /auth/me network error → token preserved", async () => {
  setAuthToken("good-tok", true);

  // Simulate a network error
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
  );

  render(<AuthProvider><Probe /></AuthProvider>);
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
  render(<AuthProvider><Capture onAuth={(a) => { auth = a; }} /></AuthProvider>);
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
    const post = vi.spyOn(client, "postJson").mockImplementation(async (path: string) =>
      (path === "/auth/passkey/options"
        ? { challenge: "ch9", options }
        : { token: "tok", user: sessionUser }) as never,
    );
    const auth = await mountAuth();
    await act(async () => auth().loginWithPasskey(remember));

    expect(post).toHaveBeenNthCalledWith(1, "/auth/passkey/options", {}, expect.anything());
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/auth/passkey",
      { challenge: "ch9", credential, remember },
      expect.anything(),
    );
    expect(await screen.findByText("in Ann")).toBeInTheDocument();
    expect(client.getAuthToken()).toBe("tok");
    const [kept, other] = where === "local" ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    expect(Object.values(kept)).toContain("tok");
    expect(Object.values(other)).not.toContain("tok");
  });

  it("loginWithPasskey signs nobody in when the browser cancels", async () => {
    const post = vi.spyOn(client, "postJson").mockResolvedValue({ challenge: "ch9", options } as never);
    vi.mocked(startAuthentication).mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    const auth = await mountAuth();
    await act(async () => {
      await expect(auth().loginWithPasskey(false)).rejects.toThrow("cancelled");
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(client.getAuthToken()).toBeNull();
    expect(screen.getByText("out")).toBeInTheDocument();
  });

  it("verifyLogin with a passkey posts the credential to the passkey endpoint", async () => {
    const post = vi.spyOn(client, "postJson").mockResolvedValue({ token: "tok", user: sessionUser } as never);
    const auth = await mountAuth();
    await act(async () => auth().verifyLogin("ch1", { passkey: credential as never }, false));
    expect(post).toHaveBeenCalledWith(
      "/auth/login/verify/passkey",
      { challenge: "ch1", credential },
      expect.anything(),
    );
    expect(await screen.findByText("in Ann")).toBeInTheDocument();
    expect(Object.values(sessionStorage)).toContain("tok");
  });

  it("verifyLogin with a code still posts to the code endpoint", async () => {
    const post = vi.spyOn(client, "postJson").mockResolvedValue({ token: "tok", user: sessionUser } as never);
    const auth = await mountAuth();
    await act(async () => auth().verifyLogin("ch1", { totp: "123456" }, true));
    expect(post).toHaveBeenCalledWith(
      "/auth/login/verify",
      { challenge: "ch1", totp: "123456" },
      expect.anything(),
    );
  });
});
