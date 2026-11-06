import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUpdateAccount } from "./accounts";
import { useSetProviderEnabled } from "./admin";
import { useChangePassword } from "./auth";
import { useDeleteConnection, useEnabledProviders } from "./connections";
import { useSaveLots } from "./holdings";
import { useTransactions } from "./transactions";
import { keys } from "./keys";
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

/** Caches an entry under each key, so a test can read which ones a write left stale. */
function seeded(...cached: (readonly unknown[])[]) {
  const { client, wrapper } = appWrapper();
  for (const key of cached) client.setQueryData(key, []);
  const stale = () => cached.filter((key) => client.getQueryState(key)?.isInvalidated);
  return { wrapper, stale };
}

describe("useUpdateAccount", () => {
  it("also refreshes the holdings and transactions tables, which render the account name", async () => {
    stubFetch(async () => jsonResponse({ id: "a1" }));
    // The two tables print accountName/accountColor from their own payload, so
    // a rename would leave them showing the old value.
    const refreshed = [
      keys.accounts(), keys.connections(), keys.accountSeries(), keys.holdings(),
      keys.investmentReturns(), keys.transactions(), keys.transactionCounts(),
    ];
    const { wrapper, stale } = seeded(...refreshed, keys.netWorth(), keys.budgetSummary());
    const { result } = renderHook(() => useUpdateAccount(), { wrapper });

    result.current.mutate({ id: "a1", name: "New", typeKey: "savings", color: "#4dd0b1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(stale()).toEqual(refreshed);
  });
});

describe("useDeleteConnection", () => {
  it("refreshes every figure the deleted connection fed, not just the list", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    const refreshed = [
      keys.connections(), keys.netWorth(), keys.accounts(), keys.accountSeries(), keys.holdings(),
      keys.holdingPrices(), keys.holdingLots(), keys.investmentReturns(), keys.transactions(),
      keys.transactionCounts(), keys.budgetLatestMonth(), keys.budgetCategories(), keys.budgetTags(),
      keys.budgetSummary(), keys.budgetTrend(), keys.budgetAiStatus(),
    ];
    const { wrapper, stale } = seeded(...refreshed, keys.sessions());
    const { result } = renderHook(() => useDeleteConnection(), { wrapper });

    result.current.mutate("c1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(stale()).toEqual(refreshed);
  });
});

describe("useSaveLots", () => {
  it("refreshes every view a saved batch changes, including account-series and this holding's own", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    const refreshed = [
      keys.holdings(), keys.investmentReturns(), keys.transactions(), keys.transactionCounts(),
      // A saved lot can be the newest row, which is where the Overview opens.
      keys.budgetLatestMonth(),
      keys.netWorth(), keys.accountSeries(), keys.holdingLots("h1"), keys.holdingPrices("h1"),
    ];
    const { wrapper, stale } = seeded(...refreshed, keys.holdingLots("h2"), keys.budgetCategories());
    const { result } = renderHook(() => useSaveLots("h1"), { wrapper });

    result.current.mutate({
      adds: [{ type: "buy", date: "2024-05-02", quantity: "20", unitPrice: "16.03" }],
      deletes: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(stale()).toEqual(refreshed);
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
  it("refreshes the sessions list so the signed-out sessions disappear", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    const { wrapper, stale } = seeded(keys.sessions());
    const { result } = renderHook(() => useChangePassword(), { wrapper });

    result.current.mutate({ currentPassword: "old", newPassword: "new" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(stale()).toEqual([keys.sessions()]);
  });
});
