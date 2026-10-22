import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsSecurity } from "./Security";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";

// Module-level spies so they can be referenced in the hoisted vi.mock factory.
const revokeSpy = vi.fn();
const revokeOthersSpy = vi.fn();
const logoutSpy = vi.fn();
const navigateSpy = vi.fn();
const updateUserSpy = vi.fn();

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

function fillPasswords() {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass12" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass12" } });
}

describe("SettingsSecurity password update", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /auth/change-password and shows success", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsSecurity />));
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
    render(withClient(<SettingsSecurity />));
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });
});

describe("SettingsSecurity password length", () => {
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const lengthError = "Your password must be 8 to 128 characters long.";

  it("refuses a too-short password on click without calling the server", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsSecurity />));
    expect(screen.queryByText("At least 8 characters")).not.toBeInTheDocument();
    set("Current password", "old-password");
    set("New password", "1234567");
    set("Confirm new password", "1234567");
    const button = screen.getByRole("button", { name: "Update password" });
    expect(button).toBeEnabled();
    expect(screen.queryByText(lengthError)).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByText(lengthError)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/change-password", expect.anything());
    // Editing the new password clears the error.
    set("New password", "12345678");
    expect(screen.queryByText(lengthError)).not.toBeInTheDocument();
  });

  it("sends a password of 8 characters", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(withClient(<SettingsSecurity />));
    set("Current password", "old-password");
    set("New password", "12345678");
    set("Confirm new password", "12345678");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/change-password",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("SettingsSecurity sessions card", () => {
  beforeEach(() => {
    revokeSpy.mockReset();
    revokeOthersSpy.mockReset();
  });

  it("lists sessions, marks current, revokes others", async () => {
    render(withClient(<SettingsSecurity />));
    // Phone and desktop layouts are both in the DOM (CSS picks one), so each
    // session appears twice.
    expect(screen.getAllByText("Chrome on macOS")).not.toHaveLength(0);
    expect(screen.getAllByText(/this device/i)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(revokeSpy).toHaveBeenCalledWith("2");
  });

  it("shows whether each session is remembered or single-session", async () => {
    render(withClient(<SettingsSecurity />));
    // The mock has one remembered session and one single-session.
    expect(screen.getByText(/remembered · 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/this session only/i)).toBeInTheDocument();
  });
});

