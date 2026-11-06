import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConnectionCallback } from "./ConnectionCallback";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

function withClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth: AuthValue = {
    isAuthenticated: true,
    user: { id: "u1", name: "Ann", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS, welcomeDone: true },
    isBootstrapping: false,
    prefs: DEFAULT_PREFS,
    login: async () => null,
    loginWithPasskey: async () => {},
    verifyLogin: async () => {},
    adoptSession: () => {},
    logout: async () => {},
    updateUser: () => {},
    updatePrefs: async () => {},
  };
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

/** Land on the callback page with the query string Powens redirected to. */
function landWith(search: string) {
  window.history.pushState({}, "", `/connections/callback${search}`);
}

const noContent = () => new Response(null, { status: 204 });

/** The calls made to one endpoint, with their method and parsed JSON body. */
function callsTo(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls
    .filter(([url]) => url === `/api${path}`)
    .map(([, init]) => ({
      method: (init as RequestInit | undefined)?.method ?? "GET",
      body: (init as RequestInit | undefined)?.body
        ? JSON.parse((init as RequestInit).body as string)
        : undefined,
    }));
}

const ERROR_TITLE = "Your bank couldn't be connected";
const CONNECTING = "Connecting your bank…";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigate.mockClear();
  fetchMock = vi.fn(async () => noContent());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("ConnectionCallback", () => {
  it("completes the connection, then goes to the connections page", async () => {
    landWith("?state=c42&code=abc&connection_id=7");
    render(withClient(<ConnectionCallback />));

    expect(screen.getByText(CONNECTING)).toBeInTheDocument();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" }),
    );
    expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
  });

  it("shows the failure at once when the provider reports an error", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/connections/complete" ? new Response("boom", { status: 400 }) : noContent(),
    );
    landWith("?state=c42&error=access_denied");
    render(withClient(<ConnectionCallback />));

    expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, "/connections/complete")).toHaveLength(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the failure when completing fails, with the way back", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/connections/complete" ? new Response("boom", { status: 500 }) : noContent(),
    );
    landWith("?state=c42&code=abc");
    render(withClient(<ConnectionCallback />));

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to connections" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });
});
