import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthProvider";
import { AuthContext, useAuth, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";
import * as client from "../api/client";
import { ApiError, getAuthToken, setAuthToken } from "../api/client";
import { startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

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
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
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

  describe("passkeys", () => {
    const mfa = {
      mfaRequired: true as const,
      challenge: "ch1",
      methods: ["totp" as const, "recovery" as const, "passkey" as const],
    };
    const options = { challenge: "abc" };
    const credential = { id: "cred" };
    const refused = "That passkey didn't work. Try again.";

    let postJson: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.mocked(startAuthentication).mockReset();
      vi.mocked(WebAuthnAbortService.cancelCeremony).mockReset();
      postJson = vi.spyOn(client, "postJson").mockResolvedValue({ options });
    });
    afterEach(() => vi.restoreAllMocks());

    /** Fill in the password step and submit it. */
    async function signInWithPassword(
      verifyLogin: AuthValue["verifyLogin"],
      methodsMfa: typeof mfa | { mfaRequired: true; challenge: string; methods: ("totp" | "recovery")[] } = mfa,
      { remember = false } = {},
    ) {
      const login = vi.fn<AuthValue["login"]>().mockResolvedValue(methodsMfa);
      render(wrapWithMock(login, <Login />, verifyLogin));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      if (remember) fireEvent.click(screen.getByLabelText("Remember me"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      });
    }

    it("tries the passkey first and signs in with the credential", async () => {
      vi.mocked(startAuthentication).mockResolvedValue(credential as never);
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockResolvedValue();
      await signInWithPassword(verifyLogin, mfa, { remember: true });
      expect(await screen.findByText("Use your passkey")).toBeInTheDocument();
      expect(screen.getByText("a@t.local")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
      await waitFor(() =>
        expect(verifyLogin).toHaveBeenCalledWith("ch1", { passkey: credential }, true),
      );
      expect(postJson).toHaveBeenCalledWith(
        "/auth/login/verify/passkey/options",
        { challenge: "ch1" },
        expect.anything(),
      );
      expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    });

    it("shows the waiting card with a way to the code while the browser answers", async () => {
      vi.mocked(startAuthentication).mockReturnValue(new Promise(() => {}));
      await signInWithPassword(vi.fn());
      expect(await screen.findByText("Waiting for your browser…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use your code instead" })).toBeInTheDocument();
    });

    it("lands on the code page without an error when the browser cancelled", async () => {
      vi.mocked(startAuthentication).mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>();
      await signInWithPassword(verifyLogin);
      expect(await screen.findByText("Enter your code")).toBeInTheDocument();
      expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
      expect(screen.getByText("or")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use a passkey" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use a backup code instead" })).toBeInTheDocument();
      expect(screen.queryByText(refused)).toBeNull();
      expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
      expect(verifyLogin).not.toHaveBeenCalled();
    });

    it("starts the passkey again from Use a passkey", async () => {
      vi.mocked(startAuthentication)
        .mockRejectedValueOnce(new DOMException("cancelled", "NotAllowedError"))
        .mockResolvedValueOnce(credential as never);
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockResolvedValue();
      await signInWithPassword(verifyLogin);
      fireEvent.click(await screen.findByRole("button", { name: "Use a passkey" }));
      await waitFor(() =>
        expect(verifyLogin).toHaveBeenCalledWith("ch1", { passkey: credential }, false),
      );
      expect(startAuthentication).toHaveBeenCalledTimes(2);
    });

    it("says the passkey didn't work on a 400", async () => {
      vi.mocked(startAuthentication).mockResolvedValue(credential as never);
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("bad", 400));
      await signInWithPassword(verifyLogin);
      expect(await screen.findByText(refused)).toBeInTheDocument();
      expect(screen.getByText("Enter your code")).toBeInTheDocument();
    });

    it("returns to the password step when the challenge expired (401)", async () => {
      vi.mocked(startAuthentication).mockResolvedValue(credential as never);
      const verifyLogin = vi.fn<AuthValue["verifyLogin"]>().mockRejectedValue(new ApiError("expired", 401));
      await signInWithPassword(verifyLogin);
      expect(await screen.findByText("That took too long. Sign in again.")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveValue("a@t.local");
      expect(screen.getByLabelText("Password")).toHaveValue("");
    });

    it("says how long to wait when the passkey step is throttled", async () => {
      postJson.mockRejectedValue(new ApiError("too many", 429, 120));
      await signInWithPassword(vi.fn());
      expect(await screen.findByText("Too many attempts. Try again in 2 minutes.")).toBeInTheDocument();
      expect(screen.getByText("Enter your code")).toBeInTheDocument();
    });

    it("Use your code instead cancels the ceremony and shows the code page", async () => {
      vi.mocked(startAuthentication).mockReturnValue(new Promise(() => {}));
      await signInWithPassword(vi.fn());
      fireEvent.click(await screen.findByRole("button", { name: "Use your code instead" }));
      expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
      expect(screen.getByText("Enter your code")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use a passkey" })).toBeInTheDocument();
    });

    it("opens no browser window when the user left before the options arrived", async () => {
      let answer!: (v: unknown) => void;
      postJson.mockReturnValue(new Promise((r) => { answer = r; }));
      await signInWithPassword(vi.fn());
      fireEvent.click(await screen.findByRole("button", { name: "Use your code instead" }));
      await act(async () => answer({ options }));
      expect(startAuthentication).not.toHaveBeenCalled();
      expect(screen.getByText("Enter your code")).toBeInTheDocument();
    });

    it("hides the passkey option without a message when none is left (409)", async () => {
      postJson.mockRejectedValue(new ApiError("no passkeys", 409));
      await signInWithPassword(vi.fn());
      expect(await screen.findByText("Enter your code")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
      expect(screen.queryByText("or")).toBeNull();
      expect(screen.queryByText(refused)).toBeNull();
      expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
      expect(startAuthentication).not.toHaveBeenCalled();
    });

    it("keeps today's code page when the account has no passkey", async () => {
      await signInWithPassword(vi.fn(), { mfaRequired: true, challenge: "ch1", methods: ["totp", "recovery"] });
      expect(await screen.findByText("Enter your code")).toBeInTheDocument();
      expect(screen.queryByText("or")).toBeNull();
      expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
      expect(startAuthentication).not.toHaveBeenCalled();
      expect(postJson).not.toHaveBeenCalled();
    });

    describe("on the password page", () => {
      it("offers a passkey sign-in under an or line", () => {
        render(wrapWithMock(vi.fn(), <Login />));
        expect(screen.getByText("or")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sign in with a passkey" })).toBeInTheDocument();
      });

      it("signs in with the passkey, passing the remember flag", async () => {
        let resolve!: () => void;
        const loginWithPasskey = vi.fn<AuthValue["loginWithPasskey"]>(
          () => new Promise<void>((r) => { resolve = r; }),
        );
        render(wrapWithMock(vi.fn(), <Login />, undefined, loginWithPasskey));
        fireEvent.click(screen.getByLabelText("Remember me"));
        fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
        expect(await screen.findByText("Waiting for your browser…")).toBeInTheDocument();
        expect(screen.getByText("Sign in with a passkey")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Use your password instead" })).toBeInTheDocument();
        expect(loginWithPasskey).toHaveBeenCalledWith(true);
        await act(async () => resolve());
      });

      it("goes back to the form with a message when the server refused (400)", async () => {
        const loginWithPasskey = vi.fn<AuthValue["loginWithPasskey"]>().mockRejectedValue(new ApiError("bad", 400));
        render(wrapWithMock(vi.fn(), <Login />, undefined, loginWithPasskey));
        fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
        expect(await screen.findByText(refused)).toBeInTheDocument();
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
      });

      it("goes back to the form with a message when the challenge expired (401)", async () => {
        const loginWithPasskey = vi.fn<AuthValue["loginWithPasskey"]>().mockRejectedValue(new ApiError("expired", 401));
        render(wrapWithMock(vi.fn(), <Login />, undefined, loginWithPasskey));
        fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
        expect(await screen.findByText(refused)).toBeInTheDocument();
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
      });

      it("goes back to the form silently when the browser cancelled", async () => {
        const loginWithPasskey = vi
          .fn<AuthValue["loginWithPasskey"]>()
          .mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
        render(wrapWithMock(vi.fn(), <Login />, undefined, loginWithPasskey));
        fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
        await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
        expect(screen.queryByText(refused)).toBeNull();
        expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
      });

      it("Use your password instead returns to the form", async () => {
        const loginWithPasskey = vi.fn<AuthValue["loginWithPasskey"]>(() => new Promise<void>(() => {}));
        render(wrapWithMock(vi.fn(), <Login />, undefined, loginWithPasskey));
        fireEvent.click(screen.getByRole("button", { name: "Sign in with a passkey" }));
        fireEvent.click(await screen.findByRole("button", { name: "Use your password instead" }));
        expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
        expect(screen.getByLabelText("Password")).toBeInTheDocument();
        expect(screen.getByText("Welcome back")).toBeInTheDocument();
      });
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
