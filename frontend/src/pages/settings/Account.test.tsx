import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsAccount } from "./Account";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";

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
  user: { id: "u1", name: "Jules", email: "jules@gripsou.local", role: "admin", prefs: DEFAULT_PREFS, welcomeDone: true },
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: vi.fn(),
  verifyLogin: vi.fn(),
  adoptSession: () => {},
  logout: logoutSpy,
  updateUser: vi.fn(),
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

type Reply = () => Response;

/** A fetch that answers `/auth/mfa/status` with the given two-factor state and
 *  any other path from `routes` (by path, after the `/api` prefix), else 204. */
function stubFetch(totp: boolean, routes: Record<string, Reply> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^\/api/, "");
    if (path === "/auth/mfa/status") {
      return new Response(JSON.stringify({ totp, recoveryRemaining: 10 }), { status: 200 });
    }
    const reply = routes[path];
    return reply ? reply() : new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const twoFactorSwitch = () =>
  screen.findByRole("switch", { name: "Two-factor authentication" });

afterEach(() => vi.unstubAllGlobals());

describe("SettingsAccount layout", () => {
  it("shows the profile line and the security rows", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    expect(screen.getByText("Jules")).toBeInTheDocument();
    expect(screen.getByText("jules@gripsou.local")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByText("Two-factor authentication")).toBeInTheDocument();
    await twoFactorSwitch();
  });

  it("opens the Edit profile window", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeInTheDocument();
    await twoFactorSwitch();
  });
});

describe("SettingsAccount two-factor row", () => {
  it("shows the switch off with a phone icon when two-factor is off", async () => {
    stubFetch(false);
    const { container } = render(withClient(<SettingsAccount />));
    const sw = await twoFactorSwitch();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector(".lucide-smartphone")).not.toBeNull();
    expect(container.querySelector(".lucide-shield-check")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });

  it("shows the switch on, a shield and the gear when two-factor is on", async () => {
    stubFetch(true);
    const { container } = render(withClient(<SettingsAccount />));
    const sw = await twoFactorSwitch();
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector(".lucide-shield-check")).not.toBeNull();
    expect(container.querySelector(".lucide-smartphone")).toBeNull();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("opens the setup window when the switch is turned on", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    fireEvent.click(await twoFactorSwitch());
    expect(screen.getByRole("dialog", { name: "Set up two-factor" })).toBeInTheDocument();
    // Opening the window does not flip the switch: the server's state does.
    expect(await twoFactorSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("asks to confirm when the switch is turned off", async () => {
    stubFetch(true);
    render(withClient(<SettingsAccount />));
    fireEvent.click(await twoFactorSwitch());
    expect(screen.getByRole("dialog", { name: "Turn off two-factor?" })).toBeInTheDocument();
    expect(await twoFactorSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("opens the manage window from the gear", async () => {
    stubFetch(true);
    render(withClient(<SettingsAccount />));
    await twoFactorSwitch();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(
      screen.getByRole("dialog", { name: "Two-factor authentication" }),
    ).toBeInTheDocument();
    // The window's backup-code count comes from the same status answer.
    expect(await screen.findByText("10 of 10 left")).toBeInTheDocument();
  });
});

describe("SettingsAccount password", () => {
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  async function openPasswordWindow() {
    render(withClient(<SettingsAccount />));
    await twoFactorSwitch();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    return screen.getByRole("dialog", { name: "Change password" });
  }

  it("posts to /auth/change-password, closes the window and says so on the row", async () => {
    const fetchMock = stubFetch(false);
    await openPasswordWindow();
    expect(screen.queryByText("Password updated")).not.toBeInTheDocument();
    set("Current password", "old");
    set("New password", "newpass12");
    set("Confirm new password", "newpass12");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Change password" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears the success line when the window is opened again", async () => {
    stubFetch(false);
    await openPasswordWindow();
    set("Current password", "old");
    set("New password", "newpass12");
    set("Confirm new password", "newpass12");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByText("Password updated")).not.toBeInTheDocument();
  });

  it("keeps the window open with a message when the current password is wrong", async () => {
    stubFetch(false, {
      "/auth/change-password": () => new Response("bad", { status: 400 }),
    });
    const dialog = await openPasswordWindow();
    set("Current password", "old");
    set("New password", "newpass12");
    set("Confirm new password", "newpass12");
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await within(dialog).findByText("Current password is incorrect")).toBeInTheDocument();
    expect(screen.queryByText("Password updated")).not.toBeInTheDocument();
  });
});

describe("SettingsAccount sessions card", () => {
  beforeEach(() => {
    revokeSpy.mockReset();
    revokeOthersSpy.mockReset();
  });

  it("lists sessions, marks current, revokes others", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    // Phone and desktop layouts are both in the DOM (CSS picks one), so each
    // session appears twice.
    expect(screen.getAllByText("Chrome on macOS")).not.toHaveLength(0);
    expect(screen.getAllByText(/this device/i)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(revokeSpy).toHaveBeenCalledWith("2");
    await twoFactorSwitch();
  });

  it("logs out every other session", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    fireEvent.click(screen.getByRole("button", { name: "Log out all other sessions" }));
    expect(revokeOthersSpy).toHaveBeenCalled();
    await twoFactorSwitch();
  });

  it("shows whether each session is remembered or single-session", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    // The mock has one remembered session and one single-session.
    expect(screen.getByText(/remembered · 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/this session only/i)).toBeInTheDocument();
    await twoFactorSwitch();
  });
});

describe("SettingsAccount delete account", () => {
  beforeEach(() => {
    logoutSpy.mockReset();
    navigateSpy.mockReset();
  });

  it("requires the typed email to match before deleting", async () => {
    stubFetch(false);
    render(withClient(<SettingsAccount />));
    await twoFactorSwitch();
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
    const fetchMock = stubFetch(false);
    render(withClient(<SettingsAccount />));
    await twoFactorSwitch();
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
