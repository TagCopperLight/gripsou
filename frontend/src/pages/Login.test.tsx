import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthProvider";
import { AuthContext, useAuth, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";
import { ApiError, getAuthToken, setAuthToken } from "../api/client";

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
  verifyLogin: AuthValue["verifyLogin"] = async () => {},
  loginWithPasskey: AuthValue["loginWithPasskey"] = async () => {},
) {
  const value: AuthValue = {
    isAuthenticated: false,
    user: null,
    isBootstrapping: false,
    prefs: DEFAULT_PREFS,
    login,
    loginWithPasskey,
    verifyLogin,
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
    const mfa = { mfaRequired: true as const, challenge: "ch1", methods: ["totp" as const, "recovery" as const] };

    /** Sign in with a password the server accepts for a two-factor account. */
    async function toCodeStep(verifyLogin: AuthValue["verifyLogin"], { remember = false } = {}) {
      const login = vi.fn<AuthValue["login"]>().mockResolvedValue(mfa);
      render(wrapWithMock(login, <Login />, verifyLogin));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      if (remember) fireEvent.click(screen.getByLabelText("Remember me"));
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await screen.findByText("Enter your code");
      return screen.getByLabelText("6-digit code");
    }

    const typeCode = (value: string) =>
      fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value } });

    it("asks for the code, showing the typed email and Change, with focus in the code field", async () => {
      const input = await toCodeStep(vi.fn());
      expect(screen.getByText("a@t.local")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use a backup code instead" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect(input).toHaveFocus();
    });

    it("sends six digits as totp with the remember flag from the password step", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockResolvedValue();
      await toCodeStep(verifyLogin, { remember: true });
      typeCode("12345");
      expect(verifyLogin).not.toHaveBeenCalled();
      typeCode("123456");
      await waitFor(() => expect(verifyLogin).toHaveBeenCalledWith("ch1", { totp: "123456" }, true));
      expect(verifyLogin).toHaveBeenCalledTimes(1);
    });

    it("keeps only digits of a pasted code", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockResolvedValue();
      await toCodeStep(verifyLogin);
      typeCode("123 45a6");
      await waitFor(() => expect(verifyLogin).toHaveBeenCalledWith("ch1", { totp: "123456" }, false));
    });

    it("says a wrong code didn't work, empties the field, and clears the message on typing", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("invalid code", 400));
      const input = await toCodeStep(verifyLogin);
      typeCode("123456");
      expect(await screen.findByText("That code didn't work. Try again.")).toBeInTheDocument();
      expect(input).toHaveValue("");
      expect(input).toHaveFocus();
      typeCode("1");
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
      expect(input).toHaveValue("1");
    });

    it("says how long to wait when the code step is throttled", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("too many", 429, 120));
      await toCodeStep(verifyLogin);
      typeCode("123456");
      expect(await screen.findByText("Too many attempts. Try again in 2 minutes.")).toBeInTheDocument();
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
    });

    it("shows a generic error, not a wrong-code one, when the server fails", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("boom", 500));
      await toCodeStep(verifyLogin);
      typeCode("123456");
      expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
    });

    it("returns to the password step when the challenge expired, keeping the email", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("challenge expired", 401));
      await toCodeStep(verifyLogin);
      typeCode("123456");
      expect(await screen.findByText("That took too long. Sign in again.")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveValue("a@t.local");
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.queryByText("Enter your code")).toBeNull();
    });

    it("Change returns to the password step keeping the email", async () => {
      await toCodeStep(vi.fn());
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      expect(screen.getByLabelText("Email")).toHaveValue("a@t.local");
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });

    it("drops a late answer to a code sent before Change", async () => {
      let reject!: (err: unknown) => void;
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>(
        () => new Promise<void>((_, r) => { reject = r; }),
      );
      await toCodeStep(verifyLogin);
      typeCode("123456");
      await waitFor(() => expect(verifyLogin).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      await act(async () => reject(new ApiError("invalid code", 400)));
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });

    it("signs in with a trimmed backup code, and goes back to the app", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockResolvedValue();
      await toCodeStep(verifyLogin, { remember: true });
      fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
      expect(screen.getByText("Enter a backup code")).toBeInTheDocument();
      expect(screen.getByText("a@t.local")).toBeInTheDocument();
      const field = screen.getByLabelText("Backup code");
      expect(field).toHaveFocus();
      fireEvent.change(field, { target: { value: "  abcde-fghij " } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() =>
        expect(verifyLogin).toHaveBeenCalledWith("ch1", { recoveryCode: "abcde-fghij" }, true),
      );

      fireEvent.click(screen.getByRole("button", { name: "Use the app instead" }));
      expect(screen.getByText("Enter your code")).toBeInTheDocument();
      expect(screen.getByLabelText("6-digit code")).toHaveValue("");
    });

    it("keeps Sign in disabled while the backup field is empty", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>();
      await toCodeStep(verifyLogin);
      fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
      const button = screen.getByRole("button", { name: "Sign in" });
      expect(button).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "   " } });
      expect(button).toBeDisabled();
      fireEvent.submit(button.closest("form")!);
      expect(verifyLogin).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "abcde-fghij" } });
      expect(button).toBeEnabled();
    });

    it("says a wrong backup code didn't work", async () => {
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("invalid code", 400));
      await toCodeStep(verifyLogin);
      fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
      fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "abcde-fghij" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(await screen.findByText("That code didn't work. Try again.")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "abcde-fghik" } });
      expect(screen.queryByText("That code didn't work. Try again.")).toBeNull();
    });
  });

  describe("second step through the real AuthProvider", () => {
    const user = { id: "u1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS };
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    afterEach(() => setAuthToken(null));

    function Status() {
      const { isAuthenticated } = useAuth();
      return <div>{isAuthenticated ? "signed in" : "signed out"}</div>;
    }

    it("stores no token after the password, then signs in after the code", async () => {
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
        url === "/api/auth/login/verify"
          ? json({ token: "tok", user })
          : json({ mfaRequired: true, challenge: "ch1", methods: ["totp", "recovery"] }),
      );
      vi.stubGlobal("fetch", fetchMock);
      render(wrap(<><Status /><Login /></>));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await screen.findByText("Enter your code");
      expect(getAuthToken()).toBeNull();
      expect(screen.getByText("signed out")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
      await waitFor(() => expect(screen.getByText("signed in")).toBeInTheDocument());
      expect(getAuthToken()).toBe("tok");
      const call = fetchMock.mock.calls.find((c) => c[0] === "/api/auth/login/verify");
      expect(JSON.parse(call![1]!.body as string)).toEqual({ challenge: "ch1", totp: "123456" });
    });
  });
});
