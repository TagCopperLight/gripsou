import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useHoldings, useUpdateAccount } from "./hooks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useHoldings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ id: "1", ticker: "AAPL", kind: "equity" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  it("fetches /api/holdings", async () => {
    const { result } = renderHook(() => useHoldings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].ticker).toBe("AAPL");
    // getJson now attaches an (empty, unauthenticated) headers object.
    expect(fetch).toHaveBeenCalledWith("/api/holdings", { headers: {} });
  });
});

describe("useUpdateAccount", () => {
  it("PATCHes /api/accounts/:id with name, typeKey and color", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "a1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useUpdateAccount(), { wrapper });
    result.current.mutate({
      id: "a1",
      name: "New name",
      typeKey: "savings",
      color: "#4dd0b1",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/accounts/a1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New name",
        typeKey: "savings",
        color: "#4dd0b1",
      }),
    });
  });
});
