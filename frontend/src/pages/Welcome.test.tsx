import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { goTo } from "../lib/navigate";
import { Welcome } from "./Welcome";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";
import type { SessionUser } from "../api/types";

vi.mock("../lib/navigate", () => ({ goTo: vi.fn() }));

let search: { step?: "bank"; callback?: string } = {};
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => search,
  useNavigate: () => navigate,
}));

const newcomer: SessionUser = {
  id: "u1", name: "Alex", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS, welcomeDone: false,
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

type Server = { status?: string; providers: { key: string; displayName: string; description: string | null }[]; aiConfigured: boolean; connections: number };
let server: Server;
let fetchMock: ReturnType<typeof vi.fn>;

function routes(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  if (url === "/api/providers/enabled") return json(server.providers);
  if (url === "/api/budget/categorize/status") return json({ configured: server.aiConfigured, running: false });
  if (url === "/api/connections")
    return json(server.connections === 0 ? [] : [{
      providerKey: "p1", providerName: "Provider",
      connections: Array.from({ length: server.connections }, (_, i) => ({
        id: `c${i}`, displayName: `Bank ${i + 1}`, status: server.status ?? "ok", lastSyncAt: null, lastError: null, accounts: [], logo: null,
      })),
    }]);
  if (url === "/api/connections/init" && method === "POST") return json({ connectionId: "c9", redirectUrl: null });
  if (url === "/api/auth/welcome" && method === "POST") return new Response(null, { status: 204 });
  return json([]);
}

function renderWelcome(overrides: Partial<AuthValue> = {}, strict = false) {
  const value: AuthValue = {
    isAuthenticated: true,
    user: newcomer,
    isBootstrapping: false,
    prefs: DEFAULT_PREFS,
    login: async () => {},
    adoptSession: () => {},
    logout: async () => {},
    updateUser: vi.fn(),
    updatePrefs: vi.fn(async () => {}),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (c: ReactNode) => (
    <QueryClientProvider client={client}><AuthContext.Provider value={value}>{c}</AuthContext.Provider></QueryClientProvider>
  );
  render(strict ? <StrictMode>{wrap(<Welcome />)}</StrictMode> : wrap(<Welcome />));
  return value;
}

const posted = (path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === `/api${path}` && (init as RequestInit | undefined)?.method === "POST");

beforeEach(() => {
  search = {};
  navigate.mockClear();
  server = { providers: [{ key: "p1", displayName: "Provider", description: null }], aiConfigured: true, connections: 0 };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => routes(url, init));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Welcome", () => {
  it("pre-fills language and time zone from the browser", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR", "en"]);
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const auth = renderWelcome();
    await waitFor(() =>
      expect(auth.updatePrefs).toHaveBeenCalledWith(
        expect.objectContaining({ uiLanguage: "fr", timeZone: browserZone, currency: "EUR" }),
      ),
    );
  });

  it("opens the bank step when coming back from the provider", async () => {
    search = { step: "bank" };
    server.connections = 1;
    renderWelcome();
    expect(await screen.findByText("Bank 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add another bank" })).toBeInTheDocument();
  });

  it("goes straight to the only provider, without the picker", async () => {
    search = { step: "bank" };
    renderWelcome();
    const connect = await screen.findByRole("button", { name: "Connect a bank" });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(posted("/connections/init")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/welcome?step=bank"));
  });

  it("opens the picker when several providers are enabled", async () => {
    search = { step: "bank" };
    server.providers.push({ key: "p2", displayName: "Other", description: null });
    renderWelcome();
    const connect = await screen.findByRole("button", { name: "Connect a bank" });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("explains when no providers are enabled", async () => {
    search = { step: "bank" };
    server.providers = [];
    renderWelcome();
    const connect = await screen.findByRole("button", { name: "Connect a bank" });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    expect(await screen.findByText(/No data providers are enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(posted("/connections/init")).toHaveLength(0);
  });

  it("hides the AI step when no AI provider is set up, and finishes from the bank step", async () => {
    search = { step: "bank" };
    server.aiConfigured = false;
    server.connections = 1;
    const auth = renderWelcome();
    const finishButton = await screen.findByRole("button", { name: "Finish" });
    await waitFor(() => expect(finishButton).toBeEnabled());
    fireEvent.click(finishButton);
    expect(screen.queryByText("Sort your spending automatically")).not.toBeInTheDocument();
    await waitFor(() => expect(posted("/auth/welcome")).toHaveLength(1));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ welcomeDone: true })));
  });

  it("shows the AI step after the bank step and saves the opt-in", async () => {
    search = { step: "bank" };
    server.connections = 1;
    const auth = renderWelcome();
    const next = await screen.findByRole("button", { name: "Continue" });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    fireEvent.click(await screen.findByRole("switch", { name: "Categorise my transactions with AI" }));
    expect(auth.updatePrefs).toHaveBeenCalledWith(expect.objectContaining({ budgetAiEnabled: true }));
  });

  it("does not rewrite prefs that already match the browser", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    const prefs = { ...DEFAULT_PREFS, uiLanguage: "fr" as const, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const auth = renderWelcome({ prefs });
    await screen.findByRole("button", { name: "Skip setup for now" });
    expect(auth.updatePrefs).not.toHaveBeenCalled();
  });

  it("shows an error and stays put when finishing fails", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === "/api/auth/welcome" ? new Response("boom", { status: 500 }) : routes(url, init),
    );
    const auth = renderWelcome();
    fireEvent.click(await screen.findByRole("button", { name: "Skip setup for now" }));
    expect(await screen.findByText("Could not finish the setup. Please try again.")).toBeInTheDocument();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("can be skipped entirely", async () => {
    const auth = renderWelcome();
    fireEvent.click(await screen.findByRole("button", { name: "Skip setup for now" }));
    await waitFor(() => expect(posted("/auth/welcome")).toHaveLength(1));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ welcomeDone: true })));
  });

  it("skips the bank step to finish when no AI provider is set up", async () => {
    search = { step: "bank" };
    server.aiConfigured = false;
    const auth = renderWelcome();
    const skip = await screen.findByRole("button", { name: "Skip this step" });
    await waitFor(() => expect(skip).toBeEnabled());
    fireEvent.click(skip);
    await waitFor(() => expect(posted("/auth/welcome")).toHaveLength(1));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ welcomeDone: true })));
  });

  it("does not leave a rejected save unhandled", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    const updatePrefs = vi.fn(async () => {
      throw new Error("save failed");
    });
    renderWelcome({ updatePrefs });
    await waitFor(() => expect(updatePrefs).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Skip setup for now" });
  });

  describe("finishing a bank connection", () => {
    const completeBody = { connectionId: "c9", params: { code: "abc" } };

    it("completes the connection, clears the callback from the URL and locks the bank step meanwhile", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/connections/complete") {
          await gate;
          return new Response(null, { status: 204 });
        }
        return routes(url, init);
      });
      renderWelcome();

      await waitFor(() => expect(posted("/connections/complete")).toHaveLength(1));
      expect(JSON.parse((posted("/connections/complete")[0][1] as RequestInit).body as string)).toEqual(completeBody);
      expect(navigate).toHaveBeenCalledWith({ to: "/welcome", search: { step: "bank" }, replace: true });
      expect(screen.getByRole("button", { name: "Connect a bank" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Skip this step" })).toBeDisabled();

      release();
      await waitFor(() => expect(screen.getByRole("button", { name: "Skip this step" })).toBeEnabled());
      expect(screen.queryByText("Your bank couldn't be connected. Nothing was saved.")).not.toBeInTheDocument();
    });

    it("deletes the pending connection and offers to try again when completing fails", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url === "/api/connections/complete" ? new Response("boom", { status: 400 }) : routes(url, init),
      );
      renderWelcome();

      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      await waitFor(() =>
        expect(fetchMock.mock.calls.filter(([u, i]) => u === "/api/connections/c9" && (i as RequestInit)?.method === "DELETE")).toHaveLength(1),
      );
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip this step" })).toBeInTheDocument();
    });

    it("deletes the pending connection without completing when the provider reported an error", async () => {
      search = { step: "bank", callback: "state=c9&error=access_denied" };
      renderWelcome();

      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      await waitFor(() =>
        expect(fetchMock.mock.calls.filter(([u, i]) => u === "/api/connections/c9" && (i as RequestInit)?.method === "DELETE")).toHaveLength(1),
      );
      expect(posted("/connections/complete")).toHaveLength(0);
    });

    it("keeps the normal actions next to the failure when another bank is already connected", async () => {
      search = { step: "bank", callback: "state=c9&error=access_denied" };
      server.connections = 1;
      renderWelcome();

      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add another bank" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("clears the failure when connecting again", async () => {
      search = { step: "bank", callback: "state=c9&error=access_denied" };
      renderWelcome();
      const retry = await screen.findByRole("button", { name: "Try again" });
      await waitFor(() => expect(retry).toBeEnabled());
      fireEvent.click(retry);
      await waitFor(() => expect(posted("/connections/init")).toHaveLength(1));
      expect(screen.queryByText("Your bank couldn't be connected. Nothing was saved.")).not.toBeInTheDocument();
    });

    const deletes = () =>
      fetchMock.mock.calls.filter(([u, i]) => u === "/api/connections/c9" && (i as RequestInit)?.method === "DELETE");
    const pendingRow = {
      providerKey: "p1", providerName: "Provider",
      connections: [{ id: "c9", displayName: "Bank 9", status: "pending", lastSyncAt: null, lastError: null, accounts: [], logo: null }],
    };

    it("does not count the pending row as a bank after a failure", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/connections/complete") return new Response("boom", { status: 400 });
        if (url === "/api/connections") return json([pendingRow]);
        return routes(url, init);
      });
      renderWelcome();

      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      expect(screen.getByText("Connecting…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip this step" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add another bank" })).not.toBeInTheDocument();
    });

    it("completes only once under StrictMode", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      renderWelcome({}, true);
      await waitFor(() => expect(posted("/connections/complete")).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(posted("/connections/complete")).toHaveLength(1);
    });

    it("deletes the pending connection only once under StrictMode when completing fails", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url === "/api/connections/complete" ? new Response("boom", { status: 400 }) : routes(url, init),
      );
      renderWelcome({}, true);
      await waitFor(() => expect(deletes()).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(deletes()).toHaveLength(1);
    });

    it("shows the failure, with no request to complete, for a callback without a state", async () => {
      search = { step: "bank", callback: "" };
      renderWelcome();
      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      expect(posted("/connections/complete")).toHaveLength(0);
      expect(deletes()).toHaveLength(0);
    });

    it("shows a pending connection as Connecting…", async () => {
      search = { step: "bank" };
      server.connections = 1;
      server.status = "pending";
      renderWelcome();
      expect(await screen.findByText("Connecting…")).toBeInTheDocument();
    });
  });
});
