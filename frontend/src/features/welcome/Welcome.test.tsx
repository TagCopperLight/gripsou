import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { goTo } from "../../lib/navigate";
import { Welcome } from "./Welcome";
import { type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../api/wire";
import type { ApiKeyProvider, SessionUser } from "../../api/wire";
import { ApiError } from "../../api/client";
import { authValue, renderWithApp, jsonResponse, stubFetch } from "../../test/kit";

vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

let search: { step?: "bank"; callback?: string } = {};
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => search }),
  useNavigate: () => navigate,
}));

const newcomer: SessionUser = {
  id: "u1", name: "Alex", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS, welcomeDone: false,
};


type Server = { status?: string; providers: { key: string; displayName: string; description: string | null }[]; aiConfigured: boolean; connections: number; bankReady: boolean };
let server: Server;
let fetchMock: ReturnType<typeof stubFetch>;

function routes(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  if (url === "/api/providers/enabled") return jsonResponse(server.providers);
  // Admin-only: what the server setup and the bank step's keys check read.
  if (url === "/api/providers") return jsonResponse(server.providers.map((p) => ({ ...p, description: "", enabled: true })));
  if (url === "/api/settings/api-keys")
    return jsonResponse([
      ...server.providers.map((p): ApiKeyProvider => ({
        key: p.key, displayName: p.displayName, group: "bank", ready: server.bankReady, returnAddress: "https://g.example/connections/callback",
        fields: [{ key: "client_id", label: "Client ID", secret: false, value: server.bankReady ? "id" : null }],
      })),
      {
        key: "logos", displayName: "Logos", group: "logos", ready: false, returnAddress: null,
        fields: [{ key: "client_id", label: "Client ID", secret: false, value: null }],
      } satisfies ApiKeyProvider,
    ]);
  if (url === "/api/budget/categorize/status") return jsonResponse({ configured: server.aiConfigured, running: false });
  if (url === "/api/connections")
    return jsonResponse(server.connections === 0 ? [] : [{
      providerKey: "p1", providerName: "Provider",
      connections: Array.from({ length: server.connections }, (_, i) => ({
        id: `c${i}`, displayName: `Bank ${i + 1}`, status: server.status ?? "ok", lastSyncAt: null, lastError: null, accounts: [], logo: null,
      })),
    }]);
  if (url === "/api/connections/init" && method === "POST") return jsonResponse({ connectionId: "c9", redirectUrl: null });
  if (url === "/api/auth/welcome" && method === "POST") return new Response(null, { status: 204 });
  // Like the server: a provider error fails the complete.
  if (url === "/api/connections/complete")
    return new Response(null, { status: String(init?.body).includes('"error"') ? 400 : 204 });
  return jsonResponse([]);
}

function renderWelcome(overrides: Partial<AuthValue> = {}) {
  const auth = authValue({ user: newcomer, ...overrides });
  renderWithApp(<Welcome />, { auth });
  return auth;
}

const posted = (path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === `/api${path}` && (init as RequestInit | undefined)?.method === "POST");

beforeEach(() => {
  search = {};
  navigate.mockClear();
  server = { providers: [{ key: "p1", displayName: "Provider", description: null }], aiConfigured: true, connections: 0, bankReady: true };
  fetchMock = stubFetch(routes);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Welcome", () => {
  it("opens on the server setup for an admin, one screen per group, then goes on to the steps", async () => {
    renderWelcome({ user: { ...newcomer, role: "admin" } });
    expect(await screen.findByRole("heading", { name: "Bank connections" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step 1 of 2" })).toBeInTheDocument();
    expect(screen.queryByText("Your preferences")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip setup for now" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Bank logos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Bank connections" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Logos aren't set up: the last screen skips to the steps.
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("Your preferences")).toBeInTheDocument();
  });

  it("starts on the steps for a member, without asking for the admin's keys", async () => {
    renderWelcome();
    expect(screen.getByText("Your preferences")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Server setup" })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/settings/api-keys")).toBe(false);
  });

  it("sends an admin back to the bank screen when the bank keys are missing", async () => {
    search = { step: "bank" };
    server.bankReady = false;
    renderWelcome({ user: { ...newcomer, role: "admin" } });
    const setUp = await screen.findByRole("button", { name: "Set up bank keys" });
    expect(screen.queryByRole("button", { name: "Connect a bank" })).not.toBeInTheDocument();
    fireEvent.click(setUp);
    expect(await screen.findByRole("heading", { name: "Bank connections" })).toBeInTheDocument();
  });

  it("pre-fills language and time zone from the browser", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR", "en"]);
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const auth = renderWelcome();
    await waitFor(() =>
      expect(auth.updatePrefs).toHaveBeenCalledWith({ uiLanguage: "fr", timeZone: browserZone }),
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
    expect(auth.updatePrefs).toHaveBeenCalledWith({ budgetAiEnabled: true });
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
    expect(await screen.findByText("Couldn't finish the setup")).toBeInTheDocument();
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

  it("says so when the server refuses a currency it has no rate for", async () => {
    const updatePrefs = vi.fn(async (patch: object) => {
      if ("currency" in patch) throw new ApiError("no rate", 502);
    });
    renderWelcome({ updatePrefs });
    fireEvent.click(await screen.findByText("EUR (€)"));
    fireEvent.click(screen.getByText("USD ($)"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get the USD rate. Try again later.");
    expect(screen.getByText("EUR (€)")).toBeInTheDocument();
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
      expect(navigate).toHaveBeenCalledWith({ to: "/welcome", search: { step: "bank" }, replace: true });
      expect(screen.getByRole("button", { name: "Connect a bank" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Skip this step" })).toBeDisabled();

      release();
      await waitFor(() => expect(screen.getByRole("button", { name: "Skip this step" })).toBeEnabled());
      expect(screen.queryByText("Your bank couldn't be connected. Nothing was saved.")).not.toBeInTheDocument();
    });

    it("offers to try again when completing fails", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url === "/api/connections/complete" ? new Response("boom", { status: 400 }) : routes(url, init),
      );
      renderWelcome();

      expect(await screen.findByText("Your bank couldn't be connected. Nothing was saved.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip this step" })).toBeInTheDocument();
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

    const pendingRow = {
      providerKey: "p1", providerName: "Provider",
      connections: [{ id: "c9", displayName: "Bank 9", status: "pending", lastSyncAt: null, lastError: null, accounts: [], logo: null }],
    };

    it("does not count the pending row as a bank after a failure", async () => {
      search = { step: "bank", callback: "state=c9&code=abc" };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/connections/complete") return new Response("boom", { status: 400 });
        if (url === "/api/connections") return jsonResponse([pendingRow]);
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

    it("shows a pending connection as Connecting…", async () => {
      search = { step: "bank" };
      server.connections = 1;
      server.status = "pending";
      renderWelcome();
      expect(await screen.findByText("Connecting…")).toBeInTheDocument();
    });
  });
});
