import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { useFinishConnection } from "./useFinishConnection";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Like the server: a provider error fails the complete.
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url === "/api/connections/complete" && String(init?.body).includes('"error"')
      ? new Response("boom", { status: 400 })
      : new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

function finish(query: string | undefined, { strict = false, onDone = vi.fn() } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return { onDone, ...renderHook(() => useFinishConnection(query, onDone), { wrapper }) };
}

const completes = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === "/api/connections/complete")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

/** A mutation reaches fetch a few ticks after the effect: give it the
 *  chance, so "nothing" means nothing and not "nothing yet". */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe("finishing a connection from the provider's callback", () => {
  it("completes it with the state as the connection id and the rest as params", async () => {
    const { result, onDone } = finish("?state=c42&code=abc&connection_id=7");
    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(completes()).toEqual([{ connectionId: "c42", params: { code: "abc", connection_id: "7" } }]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("passes a provider error on to complete, which cleans up, with no delete of its own", async () => {
    const { result, onDone } = finish("state=c42&error=access_denied");
    expect(result.current.providerError).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(completes()).toEqual([{ connectionId: "c42", params: { error: "access_denied" } }]);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/connections/c42")).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("fails at once, with no request, without a state", async () => {
    for (const query of ["?code=abc", ""]) {
      const { result } = finish(query);
      expect(result.current.status).toBe("failed");
    }
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when there is no callback", async () => {
    const { result } = finish(undefined);
    await settle();
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes only once under StrictMode's double effect run", async () => {
    const { result } = finish("?state=c42&code=abc", { strict: true });
    await waitFor(() => expect(result.current.status).toBe("done"));
    await settle();
    expect(completes()).toHaveLength(1);
  });
});
