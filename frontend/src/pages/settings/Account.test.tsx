import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsAccount } from "./Account";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";

// Module-level spies so they can be referenced in the hoisted vi.mock factory.
const logoutSpy = vi.fn();
const navigateSpy = vi.fn();
const updateUserSpy = vi.fn();

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateSpy }));

const authValue: AuthValue = {
  isAuthenticated: true,
  user: { id: "u1", name: "Jules", email: "jules@gripsou.local", role: "admin", prefs: DEFAULT_PREFS, welcomeDone: true },
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: vi.fn(),
  verifyLogin: vi.fn(),
  adoptSession: () => {},
  logout: logoutSpy,
  updateUser: updateUserSpy,
  updatePrefs: async () => {},
};

function withClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe("SettingsAccount profile", () => {
  beforeEach(() => {
    updateUserSpy.mockReset();
    vi.restoreAllMocks();
  });

  it("disables save until a field changes, then patches /auth/me", async () => {
    const updated = { id: "u1", name: "Jules Renamed", email: "jules@gripsou.local", role: "admin", prefs: DEFAULT_PREFS };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(updated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsAccount />));

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jules Renamed" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(await screen.findByText("Profile updated")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(updateUserSpy).toHaveBeenCalledWith(updated);
  });

  it("shows a conflict message when the email is already in use", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("taken", { status: 409 })));
    render(withClient(<SettingsAccount />));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "taken@gripsou.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("That email is already in use")).toBeInTheDocument();
  });
});

describe("SettingsAccount delete account", () => {
  beforeEach(() => {
    logoutSpy.mockReset();
    navigateSpy.mockReset();
  });

  it("requires the typed email to match before deleting", async () => {
    render(withClient(<SettingsAccount />));
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));

    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(/type .* to confirm/i);
    fireEvent.change(input, { target: { value: "wrong@gripsou.local" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "jules@gripsou.local" } });
    expect(confirm).toBeEnabled();
  });

  it("deletes via DELETE /auth/account, then logs out and redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsAccount />));
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: "jules@gripsou.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    // RTL's `waitFor`, not `vi.waitFor`: the delete mutation resolves and sets
    // state between polls, and only RTL's wraps the wait in act(...).
    await waitFor(() => expect(logoutSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/account",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(navigateSpy).toHaveBeenCalledWith({ to: "/login" });
  });
});
