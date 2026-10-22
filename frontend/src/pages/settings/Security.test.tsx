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


type Status = { totp: boolean; recoveryRemaining: number; available: boolean };
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubMfa(status: Status, extra: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    "/api/auth/mfa/status": () => jsonRes(status),
    "/api/auth/reauth": () => jsonRes({ reauth: "tok-1" }),
    ...extra,
  };
  const fetchMock = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected ${url}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function confirmReauth() {
  fireEvent.change(await screen.findByLabelText("Password", { selector: "input[autocomplete=current-password]" }), {
    target: { value: "hunter2hunter2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
}

describe("SettingsSecurity two-factor card", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("offers Set up when no authenticator is registered", async () => {
    stubMfa({ totp: false, recoveryRemaining: 0, available: true });
    render(withClient(<SettingsSecurity />));
    expect(await screen.findByRole("button", { name: "Set up" })).toBeInTheDocument();
    expect(screen.getByText("Authenticator app")).toBeInTheDocument();
    expect(screen.queryByText("Backup codes")).not.toBeInTheDocument();
  });

  it("shows On, Remove and the codes left when it is registered", async () => {
    stubMfa({ totp: true, recoveryRemaining: 7, available: true });
    render(withClient(<SettingsSecurity />));
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByText("7 left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("uses the singular for one code left", async () => {
    stubMfa({ totp: true, recoveryRemaining: 1, available: true });
    render(withClient(<SettingsSecurity />));
    expect(await screen.findByText("1 left")).toBeInTheDocument();
  });

  it("says so, with no button, when the server cannot do it", async () => {
    stubMfa({ totp: false, recoveryRemaining: 0, available: false });
    render(withClient(<SettingsSecurity />));
    expect(await screen.findByText("Not available on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up" })).not.toBeInTheDocument();
  });

  it("asks for the password, then opens the setup with the reauth token", async () => {
    const fetchMock = stubMfa(
      { totp: false, recoveryRemaining: 0, available: true },
      {
        "/api/auth/mfa/totp/setup": () => jsonRes({ secret: "ABCDEFGH", qrSvg: "<svg/>" }),
      },
    );
    render(withClient(<SettingsSecurity />));
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    await confirmReauth();
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/totp/setup",
      expect.objectContaining({ body: JSON.stringify({ reauth: "tok-1" }) }),
    );
  });

  it("shows the expiry message when the setup token was rejected", async () => {
    stubMfa(
      { totp: false, recoveryRemaining: 0, available: true },
      { "/api/auth/mfa/totp/setup": () => new Response("no", { status: 401 }) },
    );
    render(withClient(<SettingsSecurity />));
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    await confirmReauth();
    expect(await screen.findByText("Confirmation expired. Please try again.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes the authenticator after reauthenticating, sending the token in the body", async () => {
    const fetchMock = stubMfa(
      { totp: true, recoveryRemaining: 5, available: true },
      { "/api/auth/mfa/totp": () => new Response(null, { status: 204 }) },
    );
    render(withClient(<SettingsSecurity />));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await confirmReauth();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/mfa/totp",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ reauth: "tok-1" }) }),
      ),
    );
  });

  it("regenerates the backup codes and shows them", async () => {
    const fetchMock = stubMfa(
      { totp: true, recoveryRemaining: 2, available: true },
      {
        "/api/auth/mfa/recovery/regenerate": () =>
          jsonRes({ recoveryCodes: ["aaaa-1111", "bbbb-2222"] }),
      },
    );
    render(withClient(<SettingsSecurity />));
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await confirmReauth();
    expect(await screen.findByText("aaaa-1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb-2222")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/recovery/regenerate",
      expect.objectContaining({ body: JSON.stringify({ reauth: "tok-1" }) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "I've saved them" }));
    expect(screen.queryByText("aaaa-1111")).not.toBeInTheDocument();
  });
});
