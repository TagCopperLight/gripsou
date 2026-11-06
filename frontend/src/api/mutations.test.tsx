import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUpdateAccount } from "./accounts";
import { useSetProviderEnabled } from "./admin";
import { useChangePassword } from "./auth";
import { useDeleteConnection, useEnabledProviders } from "./connections";
import { useSaveLots } from "./holdings";
import { useTransactions } from "./transactions";
import { appWrapper, jsonResponse, stubFetch } from "../test/kit";

// The page size the list asks the server for.
const TRANSACTIONS_PAGE_SIZE = 200;

it("refreshes the connection picker after a provider is disabled", async () => {
  let enabled = true;
  stubFetch(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      enabled = false;
      return new Response(null, { status: 204 });
    }
    return Response.json(enabled ? [{ key: "powens", name: "Powens" }] : []);
  });
  const { client, wrapper: w } = appWrapper();
  const { result, unmount } = renderHook(() => ({ list: useEnabledProviders(), toggle: useSetProviderEnabled() }), { wrapper: w });
  try {
    await waitFor(() => expect(result.current.list.data?.length).toBe(1));
    result.current.toggle.mutate({ key: "powens", enabled: false });
    await waitFor(() => expect(result.current.list.data).toEqual([]));
  } finally { unmount(); client.clear(); }
});

describe("useUpdateAccount invalidation", () => {
  it("also refreshes the holdings and transactions tables, which render the account name", async () => {
    stubFetch(async () => jsonResponse({ id: "a1" }));

    const { client, wrapper: w } = appWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateAccount(), { wrapper: w });

    result.current.mutate({ id: "a1", name: "New", typeKey: "savings", color: "#4dd0b1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    // The last two: both tables print accountName/accountColor from their own
    // payload, so a rename would leave them showing the old value.
    expect(invalidatedKeys).toEqual([
      ["accounts"],
      ["connections"],
      ["account-series"],
      ["holdings"],
      ["investment-returns"],
      ["transactions"],
      ["transaction-counts"],
    ]);
  });
});

describe("useDeleteConnection", () => {
  it("refreshes every figure the deleted connection fed, not just the list", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    const { client, wrapper: w } = appWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteConnection(), { wrapper: w });

    result.current.mutate("c1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toEqual([
      ["connections"],
      ["net-worth"],
      ["accounts"],
      ["account-series"],
      ["holdings"],
      ["holding-prices"],
      ["holding-lots"],
      ["investment-returns"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-latest-month"],
      ["budget-categories"],
      ["budget-tags"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-status"],
    ]);
  });
});

describe("useSaveLots", () => {
  it("invalidates every query a saved batch changes, including account-series and holding-* views", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    const { client, wrapper: w } = appWrapper();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveLots("h1"), { wrapper: w });

    result.current.mutate({
      adds: [{ type: "buy", date: "2024-05-02", quantity: "20", unitPrice: "16.03" }],
      deletes: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["holdings"]);
    expect(invalidatedKeys).toContainEqual(["investment-returns"]);
    expect(invalidatedKeys).toContainEqual(["transactions"]);
    expect(invalidatedKeys).toContainEqual(["transaction-counts"]);
    // A saved lot can be the newest row, which is where the Overview opens.
    expect(invalidatedKeys).toContainEqual(["budget-latest-month"]);
    expect(invalidatedKeys).toContainEqual(["net-worth"]);
    expect(invalidatedKeys).toContainEqual(["account-series"]);
    expect(invalidatedKeys).toContainEqual(["holding-lots", "h1"]);
    expect(invalidatedKeys).toContainEqual(["holding-prices", "h1"]);
  });
});

describe("useTransactions", () => {
  function page(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
  }

  it("requests the first page at offset 0 with the page-size limit", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(page(TRANSACTIONS_PAGE_SIZE)));

    const { result } = renderHook(() => useTransactions({ search: "leclerc" }), appWrapper());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/transactions?search=leclerc&limit=${TRANSACTIONS_PAGE_SIZE}&offset=0`,
      { method: "GET", headers: {}, signal: expect.any(AbortSignal) },
    );
    expect(result.current.hasNextPage).toBe(true);
  });

  it("fetches the next page at the accumulated offset, and stops once a page comes back short", async () => {
    const fetchMock = stubFetch()
      .mockResolvedValueOnce(
        jsonResponse(page(TRANSACTIONS_PAGE_SIZE)),
      )
      .mockResolvedValueOnce(
        jsonResponse(page(5)),
      );

    const { result } = renderHook(() => useTransactions({}), appWrapper());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/transactions?limit=${TRANSACTIONS_PAGE_SIZE}&offset=${TRANSACTIONS_PAGE_SIZE}`,
      { method: "GET", headers: {}, signal: expect.any(AbortSignal) },
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useChangePassword", () => {
  it("invalidates the sessions query on success so stale sessions disappear", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    const { client, wrapper: w } = appWrapper();
    // Pre-seed the sessions cache so there is a query to invalidate.
    client.setQueryData(["sessions"], [{ id: "s1" }]);

    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useChangePassword(), { wrapper: w });

    result.current.mutate({ currentPassword: "old", newPassword: "new" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
  });
});
