import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthProvider";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";
import { getAuthToken, setAuthToken } from "../api/client";

// Login itself doesn't navigate — the /login route guard redirects once auth
// flips (see router.test.tsx for that end-to-end flow). Here we only assert it
// calls `login` correctly and surfaces credential errors.
function wrap(children: ReactNode) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Render Login with a fully controlled auth context (no real provider). */
function wrapWithMock(
  login: AuthValue["login"],
  children: ReactNode,
) {
  const value: AuthValue = {
    isAuthenticated: false,
    user: null,
    isBootstrapping: false,
    prefs: DEFAULT_PREFS,
    login,
    verifyLogin: async () => {},
    adoptSession: () => {},
    logout: async () => {},
    updateUser: () => {},
    updatePrefs: async () => {},
  };
  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

describe("Login", () => {
  it("logs in with the entered credentials on success", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ token: "t", user: { id: "u1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<Login />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(screen.queryByText("Invalid email or password")).toBeNull();
  });

  it("shows an error on bad credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    render(wrap(<Login />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("says how long to wait when throttled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("too many attempts", { status: 429, headers: { "Retry-After": "181" } }),
    ));
    render(wrap(<Login />));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Too many attempts. Try again in 4 minutes.")).toBeInTheDocument();
    expect(screen.queryByText("Invalid email or password")).toBeNull();
  });

  it("passes remember=true when checked", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    render(wrapWithMock(login, <Login />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByLabelText(/remember me/i));
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a@t.local", "pw", true));
  });

  describe("second step", () => {
    const user = { id: "u1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS };
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
    const challenge = (methods = ["totp", "recovery"]) =>
      json({ mfaRequired: true, challenge: "ch1", methods });

    afterEach(() => setAuthToken(null));

    function mockFetch(verify: () => Response) {
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
        url === "/api/auth/login/verify" ? verify() : challenge(),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    async function toCodeStep() {
      render(wrap(<Login />));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await screen.findByText("Two-factor authentication");
    }

    const verifyBody = (fetchMock: ReturnType<typeof mockFetch>) => {
      const call = fetchMock.mock.calls.find((c) => c[0] === "/api/auth/login/verify");
      return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
    };

    it("shows the code field and stores no token after the password", async () => {
      mockFetch(() => json({ token: "t", user }));
      await toCodeStep();
      expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect(getAuthToken()).toBeNull();
    });

    it("submits at six digits and stores the token", async () => {
      const fetchMock = mockFetch(() => json({ token: "tok", user }));
      await toCodeStep();
      fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "12a3456" } });
      await waitFor(() => expect(verifyBody(fetchMock)).toEqual({ challenge: "ch1", totp: "123456" }));
      await waitFor(() => expect(getAuthToken()).toBe("tok"));
    });

    it("shows an invalid-code message and clears the field on 400", async () => {
      mockFetch(() => new Response("invalid code", { status: 400 }));
      await toCodeStep();
      const input = screen.getByLabelText("Authentication code");
      fireEvent.change(input, { target: { value: "123456" } });
      expect(await screen.findByText("That code didn't work. Try again.")).toBeInTheDocument();
      await waitFor(() => expect(input).toHaveValue(""));
      await waitFor(() => expect(input).toHaveFocus());
    });

    it("does not send an incomplete authenticator code on Enter", async () => {
      const fetchMock = mockFetch(() => json({ token: "tok", user }));
      await toCodeStep();
      const input = screen.getByLabelText("Authentication code");
      fireEvent.change(input, { target: { value: "12345" } });
      fireEvent.submit(input.closest("form")!);
      await new Promise((r) => setTimeout(r, 0));
      expect(verifyBody(fetchMock)).toBeNull();
      expect(input).toHaveValue("12345");
    });

    it("shows a generic error, not a wrong-code one, when the server fails", async () => {
      mockFetch(() => new Response("boom", { status: 500 }));
      await toCodeStep();
      fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "123456" } });
      expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
    });

    it("shows a generic error when the network fails", async () => {
      const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
        if (url === "/api/auth/login/verify") throw new TypeError("Failed to fetch");
        return challenge();
      });
      vi.stubGlobal("fetch", fetchMock);
      await toCodeStep();
      fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "123456" } });
      expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
    });

    it("sends a backup code as recoveryCode", async () => {
      const fetchMock = mockFetch(() => json({ token: "tok", user }));
      await toCodeStep();
      fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
      fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "abcd-efgh" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify" }));
      await waitFor(() => expect(verifyBody(fetchMock)).toEqual({ challenge: "ch1", recoveryCode: "abcd-efgh" }));
      expect(screen.queryByRole("button", { name: "Use a backup code" })).toBeNull();
    });

    it("goes back to the password form keeping the email", async () => {
      mockFetch(() => json({ token: "t", user }));
      await toCodeStep();
      fireEvent.click(screen.getByRole("button", { name: "← Back" }));
      expect(screen.getByLabelText("Email")).toHaveValue("a@t.local");
      expect(screen.getByLabelText("Password")).toHaveValue("");
    });

    it("returns to the password form when the challenge expired", async () => {
      mockFetch(() => new Response("challenge expired", { status: 401 }));
      await toCodeStep();
      fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "123456" } });
      expect(
        await screen.findByText("Sign-in took too long. Enter your password again."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toHaveValue("");
    });

    it("says how long to wait when throttled", async () => {
      mockFetch(() => new Response("too many", { status: 429, headers: { "Retry-After": "60" } }));
      await toCodeStep();
      fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "123456" } });
      expect(await screen.findByText("Too many attempts. Try again in 1 minute.")).toBeInTheDocument();
    });

    it("signs in directly without two-factor", async () => {
      const fetchMock = vi.fn(async () => json({ token: "tok", user }));
      vi.stubGlobal("fetch", fetchMock);
      render(wrap(<Login />));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => expect(getAuthToken()).toBe("tok"));
      expect(screen.queryByText("Two-factor authentication")).toBeNull();
    });
  });
});
