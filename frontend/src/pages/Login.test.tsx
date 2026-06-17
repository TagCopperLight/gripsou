import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthProvider";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";

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

  it("passes remember=true when checked", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    render(wrapWithMock(login, <Login />));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByLabelText(/remember me/i));
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a@t.local", "pw", true));
  });
});
