import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { ConnectionCallback } from "./ConnectionCallback";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

function withClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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

const ERROR_TITLE = "Something went wrong connecting your account.";

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
  it("completes the connection without the state param, then goes to the connections page", async () => {
    landWith("?state=c42&code=abc&connection_id=7");
    render(withClient(<ConnectionCallback />));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" }),
    );
    expect(callsTo(fetchMock, "/connections/complete")).toEqual([
      {
        method: "POST",
        body: { connectionId: "c42", params: { code: "abc", connection_id: "7" } },
      },
    ]);
    expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
  });

  it("deletes the pending connection and shows the error screen when Powens reports an error", async () => {
    landWith("?state=c42&error=access_denied");
    render(withClient(<ConnectionCallback />));

    expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(fetchMock, "/connections/c42")).toEqual([
        { method: "DELETE", body: undefined },
      ]),
    );
    expect(callsTo(fetchMock, "/connections/complete")).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the error screen and calls nothing when there is no state param", async () => {
    landWith("?code=abc");
    render(withClient(<ConnectionCallback />));

    expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
    // A mutation reaches fetch a few ticks after the effect: give it the
    // chance, so "nothing" means nothing and not "nothing yet".
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the error screen when completing fails, with a way back to the connections page", async () => {
    fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
    landWith("?state=c42&code=abc");
    render(withClient(<ConnectionCallback />));

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to connections" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" });
  });

  it("completes only once under StrictMode's double effect run", async () => {
    landWith("?state=c42&code=abc");
    render(
      <StrictMode>{withClient(<ConnectionCallback />)}</StrictMode>,
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/settings/connections" }),
    );
    expect(callsTo(fetchMock, "/connections/complete")).toHaveLength(1);
  });
});
