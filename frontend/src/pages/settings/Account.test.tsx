import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsAccount } from "./Account";
import { AuthContext, type AuthValue } from "../../auth/context";

// Module-level spies so they can be referenced in the hoisted vi.mock factory.
const revokeSpy = vi.fn();
const revokeOthersSpy = vi.fn();
const logoutSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateSpy }));

vi.mock("../../api/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/hooks")>();
  return {
    ...actual,
    useSessions: () => ({
      data: [
        {
          id: "1",
          device: "Chrome on macOS",
          ip: "1.2.3.4",
          createdAt: 0,
          lastActiveAt: 0,
          remembered: true,
          current: true,
        },
        {
          id: "2",
          device: "Firefox on Linux",
          ip: null,
          createdAt: 0,
          lastActiveAt: 0,
          remembered: false,
          current: false,
        },
      ],
    }),
    useRevokeSession: () => ({ mutate: revokeSpy, isPending: false }),
    useRevokeOtherSessions: () => ({ mutate: revokeOthersSpy, isPending: false }),
  };
});

const authValue: AuthValue = {
  isAuthenticated: true,
  user: { id: "u1", name: "Julien", email: "julien@gripsou.local", role: "admin" },
  isBootstrapping: false,
  login: vi.fn(),
  logout: logoutSpy,
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

function fillPasswords() {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass" } });
}

describe("SettingsAccount password update", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /auth/change-password and shows success", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsAccount />));
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows an error when the current password is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    render(withClient(<SettingsAccount />));
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });
});

describe("SettingsAccount sessions card", () => {
  beforeEach(() => {
    revokeSpy.mockReset();
    revokeOthersSpy.mockReset();
  });

  it("lists sessions, marks current, revokes others", async () => {
    render(withClient(<SettingsAccount />));
    expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText(/this device/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    expect(revokeSpy).toHaveBeenCalledWith("2");
  });

  it("shows whether each session is remembered or single-session", async () => {
    render(withClient(<SettingsAccount />));
    // The mock has one remembered session and one single-session.
    expect(screen.getByText(/remembered · 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/this session only/i)).toBeInTheDocument();
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

    fireEvent.change(input, { target: { value: "julien@gripsou.local" } });
    expect(confirm).toBeEnabled();
  });

  it("deletes via DELETE /auth/account, then logs out and redirects", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsAccount />));
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: "julien@gripsou.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

    await vi.waitFor(() => expect(logoutSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/account",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(navigateSpy).toHaveBeenCalledWith({ to: "/login" });
  });
});
