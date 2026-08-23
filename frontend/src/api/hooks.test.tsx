import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  TRANSACTIONS_PAGE_SIZE,
  useSaveLots,
  useChangePassword,
  useHoldings,
  useTransactions,
  useUpdateAccount,
} from "./hooks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
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

describe("useSaveLots", () => {
  it("invalidates every query a saved batch changes, including account-series and holding-* views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const { client, wrapper: w } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveLots("h1"), { wrapper: w });

    result.current.mutate({
      adds: [{ type: "buy", date: "2024-05-02", quantity: "20", unitPrice: "16.03" }],
      deletes: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["holdings"]);
    expect(invalidatedKeys).toContainEqual(["transactions"]);
    expect(invalidatedKeys).toContainEqual(["net-worth"]);
    expect(invalidatedKeys).toContainEqual(["account-series"]);
    expect(invalidatedKeys).toContainEqual(["holding-transactions", "h1"]);
    expect(invalidatedKeys).toContainEqual(["holding-prices", "h1"]);
  });
});

describe("useTransactions", () => {
  function page(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
  }

  it("requests the first page at offset 0 with the page-size limit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(page(TRANSACTIONS_PAGE_SIZE)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTransactions({ search: "leclerc" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/transactions?search=leclerc&limit=${TRANSACTIONS_PAGE_SIZE}&offset=0`,
      { headers: {} },
    );
    expect(result.current.hasNextPage).toBe(true);
  });

  it("fetches the next page at the accumulated offset, and stops once a page comes back short", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page(TRANSACTIONS_PAGE_SIZE)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page(5)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTransactions({}), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/transactions?limit=${TRANSACTIONS_PAGE_SIZE}&offset=${TRANSACTIONS_PAGE_SIZE}`,
      { headers: {} },
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useChangePassword", () => {
  it("invalidates the sessions query on success so stale sessions disappear", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const { client, wrapper: w } = makeWrapper();
    // Pre-seed the sessions cache so there is a query to invalidate.
    client.setQueryData(["sessions"], [{ id: "s1" }]);

    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useChangePassword(), { wrapper: w });

    result.current.mutate({ currentPassword: "old", newPassword: "new" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
  });
});
