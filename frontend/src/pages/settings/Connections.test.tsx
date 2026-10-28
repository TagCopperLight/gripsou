import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsConnections } from "./Connections";
import type { EnabledProvider, ProviderGroup } from "../../api/types";
import { goTo } from "../../lib/navigate";

vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const json = (body: unknown) => Response.json(body);
let providers: EnabledProvider[];
let fetchMock: ReturnType<typeof vi.fn>;

const GROUPS: ProviderGroup[] = [
  {
    providerKey: "powens",
    providerName: "Powens",
    connections: [
      {
        id: "c1",
        displayName: "Boursorama",
        status: "ok",
        lastSyncAt: 1_700_000_000_000,
        lastError: null,
        accounts: [
          { id: "a1", name: "Compte courant", color: "#3b82f6", typeKey: "checking", value: "1234.50", lastSyncAt: 1_700_000_000_000 },
          { id: "a2", name: "Livret A", color: "#4dd0b1", typeKey: "savings", value: "8000.00", lastSyncAt: 1_700_000_000_000 },
        ],
        logo: null,
      },
      {
        id: "c2",
        displayName: "Example Broker",
        status: "error",
        lastSyncAt: null,
        lastError: "Credentials expired",
        accounts: [],
        logo: null,
      },
    ],
  },
];

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SettingsConnections", () => {
  beforeEach(() => {
    vi.mocked(goTo).mockClear();
    providers = [{ key: "powens", displayName: "Powens", description: null }];
    fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/providers/enabled") return json(providers);
      if (url === "/api/connections/init") return json({ connectionId: "c3", redirectUrl: "https://provider.test/connect" });
      return json(GROUPS);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows an error state with retry when the fetch fails", async () => {
    // isLoading is false once a query errors, so the error branch must not be
    // nested under isLoading — otherwise an API failure shows the empty state.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("nope", { status: 500 }),
    ));
    render(withClient(<SettingsConnections />));
    expect(await screen.findByText("Couldn't load this")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("expands a connection to reveal its accounts", async () => {
    render(withClient(<SettingsConnections />));
    const header = await screen.findByText("Boursorama");
    expect(screen.queryByText("Compte courant")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("Compte courant")).toBeInTheDocument();
    expect(screen.getByText("Livret A")).toBeInTheDocument();
  });

  it("names the bank when asking to delete it", async () => {
    render(withClient(<SettingsConnections />));
    await screen.findByText("Boursorama");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete connection" })[0]);
    expect(screen.getByRole("dialog", { name: "Delete Boursorama?" })).toBeInTheDocument();
  });

  it("starts the only provider directly and follows its redirect", async () => {
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("https://provider.test/connect"));
    expect(fetchMock).toHaveBeenCalledWith("/api/connections/init", expect.objectContaining({
      method: "POST", body: JSON.stringify({ providerKey: "powens" }),
    }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns to connections when the provider needs no redirect", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/providers/enabled") return json(providers);
      if (url === "/api/connections/init") return json({ connectionId: "c3", redirectUrl: null });
      return json(GROUPS);
    });
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/settings/connections"));
  });

  it("waits for providers and prevents another start while connecting", async () => {
    let resolveProviders!: (response: Response) => void;
    let resolveInit!: (response: Response) => void;
    const providerResponse = new Promise<Response>((resolve) => { resolveProviders = resolve; });
    const initResponse = new Promise<Response>((resolve) => { resolveInit = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/providers/enabled") return providerResponse;
      if (url === "/api/connections/init") return initResponse;
      return json(GROUPS);
    });
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolveProviders(json(providers));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(add).toBeDisabled());
    fireEvent.click(add);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/connections/init")).toHaveLength(1);
    resolveInit(json({ connectionId: "c3", redirectUrl: null }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/settings/connections"));
  });

  it("shows a failure and lets the user retry the direct connection", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/providers/enabled") return json(providers);
      if (url === "/api/connections/init") return fail
        ? new Response("nope", { status: 500 })
        : json({ connectionId: "c3", redirectUrl: null });
      return json(GROUPS);
    });
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open the bank connection");
    expect(goTo).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(add);
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/settings/connections"));
  });

  it("keeps the picker when several providers are enabled", async () => {
    providers.push({ key: "other", displayName: "Other provider", description: null });
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Other provider")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/connections/init")).toBe(false);
    fireEvent.click(screen.getByText("Other provider"));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/connections/init", expect.objectContaining({
      body: JSON.stringify({ providerKey: "other" }),
    })));
  });

  it("explains when no providers are enabled", async () => {
    providers = [];
    render(withClient(<SettingsConnections />));
    const add = screen.getByRole("button", { name: "Add connection" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByText(/No data providers are enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/connections/init")).toBe(false);
  });

  it("with no bank, offers one Add button, in the empty state, and the guide", async () => {
    fetchMock.mockImplementation(async (url: string) => (url === "/api/providers/enabled" ? json(providers) : json([])));
    render(withClient(<SettingsConnections />));
    expect(await screen.findByText("Connect your first bank")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add connection" })).toHaveLength(1);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });
});
