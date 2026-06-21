import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Invite } from "./Invite";
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

const tokenOk = () =>
  new Response(JSON.stringify({ type: "invite", email: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  navigate.mockClear();
});

describe("Invite", () => {
  it("creates an account and adopts the session", async () => {
    const adopt = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenOk()) // page-load guard
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "sess",
            user: { id: "u1", name: "New", email: "new@t.local", role: "user", prefs: DEFAULT_PREFS },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<Invite />, adopt));

    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(adopt).toHaveBeenCalledWith("sess", expect.objectContaining({ id: "u1" })));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("shows an email-exists error on 409", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(new Response("dup", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(wrap(<Invite />));

    await screen.findByLabelText("Name");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@t.local" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("An account with this email already exists")).toBeInTheDocument();
  });
});
