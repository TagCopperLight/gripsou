import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Reset } from "./Reset";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ token: "tok" }),
}));

function wrap(children: ReactNode, adoptSession = vi.fn()) {
  const value: AuthValue = {
    isAuthenticated: false,
    user: null,
    isBootstrapping: false,
    prefs: DEFAULT_PREFS,
    login: async () => {},
    adoptSession,
    logout: async () => {},
    updateUser: () => {},
    updatePrefs: async () => {},
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

beforeEach(() => navigate.mockClear());

describe("Reset", () => {
  it("sets a new password and adopts the session", async () => {
    const adopt = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "reset", email: "u@t.local" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "sess",
            user: { id: "u1", name: "U", email: "u@t.local", role: "user", prefs: DEFAULT_PREFS },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<Reset />, adopt));

    await screen.findByLabelText("New password");
    expect(screen.getByText("u@t.local")).toBeInTheDocument();
    expect(
      screen.getByText("Two-factor authentication will be turned off. You can set it up again in Settings."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(adopt).toHaveBeenCalledWith("sess", expect.objectContaining({ id: "u1" })));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("refuses a too-short password without calling the server", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "reset", email: "u@t.local" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<Reset />));

    await screen.findByLabelText("New password");
    expect(screen.queryByText("At least 8 characters")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Your password must be 8 to 128 characters long.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/redeem"))).toBe(false);
  });
});
