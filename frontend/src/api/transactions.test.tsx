import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useTransactions, useTransactionCounts } from "./hooks";
import { usePatchTransaction, useApplyToDescription, useBulkTransactions } from "./budget";
import type { TransactionFilterQuery } from "./types";
import { keys } from "./keys";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastUrl(): string {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return String(calls[calls.length - 1][0]);
}

function lastBody(): unknown {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const init = calls[calls.length - 1][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("transaction queries", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
  });

  it("serialises every filter, joins id lists with commas and never sends `type`", async () => {
    renderHook(
      () =>
        useTransactions({
          search: "leclerc",
          accountId: "acc-1",
          bucket: "out",
          from: "2026-01-01",
          to: "2026-01-31",
          categoryIds: ["c1", "c2"],
          tagIds: ["t1"],
          uncategorized: true,
          needsReview: true,
          includeTransfers: true,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const url = lastUrl();
    expect(url).toContain("search=leclerc");
    expect(url).toContain("accountId=acc-1");
    expect(url).toContain("bucket=out");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-31");
    expect(url).toContain("categoryIds=c1%2Cc2");
    expect(url).toContain("tagIds=t1");
    expect(url).toContain("uncategorized=true");
    expect(url).toContain("needsReview=true");
    expect(url).toContain("includeTransfers=true");
    expect(url).not.toContain("type=");
  });

  it("omits empty filters entirely", async () => {
    renderHook(() => useTransactions({ categoryIds: [], tagIds: [], uncategorized: false }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const url = lastUrl();
    expect(url).not.toContain("categoryIds");
    expect(url).not.toContain("tagIds");
    expect(url).not.toContain("uncategorized");
  });

  it("reads the counts endpoint with the same filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ matching: 12, total: 400, uncategorized: 300 })),
    );
    const { result } = renderHook(() => useTransactionCounts({ bucket: "in" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(lastUrl()).toContain("/transactions/counts?");
    expect(lastUrl()).toContain("bucket=in");
    expect(result.current.data).toEqual({ matching: 12, total: 400, uncategorized: 300 });
  });
});

describe("transaction mutations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ sameDescriptionCount: 3, updated: 7 })));
  });

  it("patches one row and returns the same-description count", async () => {
    const { result } = renderHook(() => usePatchTransaction(), { wrapper: wrapper() });
    const res = await result.current.mutateAsync({ id: "tx-1", body: { categoryId: "c1" } });
    expect(lastUrl()).toContain("/transactions/tx-1");
    expect(lastBody()).toEqual({ categoryId: "c1" });
    expect(res.sameDescriptionCount).toBe(3);
  });

  it("clears a category by sending an explicit null", async () => {
    const { result } = renderHook(() => usePatchTransaction(), { wrapper: wrapper() });
    await result.current.mutateAsync({ id: "tx-1", body: { categoryId: null } });
    expect(lastBody()).toEqual({ categoryId: null });
  });

  it("sends the whole tag set on a tag write — the server has no add/remove split", async () => {
    const { result } = renderHook(() => usePatchTransaction(), { wrapper: wrapper() });
    await result.current.mutateAsync({ id: "tx-1", body: { tagIds: ["t1", "t2"] } });
    expect(lastBody()).toEqual({ tagIds: ["t1", "t2"] });
  });

  it("applies a category to every row sharing the description", async () => {
    const { result } = renderHook(() => useApplyToDescription(), { wrapper: wrapper() });
    const res = await result.current.mutateAsync({ id: "tx-1", categoryId: "c2" });
    expect(lastUrl()).toContain("/transactions/tx-1/apply-to-description");
    expect(lastBody()).toEqual({ categoryId: "c2" });
    expect(res.updated).toBe(7);
  });

  it("sends explicit ids when rows were picked", async () => {
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: wrapper() });
    await result.current.mutateAsync({ ids: ["a", "b"], categoryId: "c1" });
    expect(lastUrl()).toContain("/transactions/bulk");
    expect(lastBody()).toEqual({ ids: ["a", "b"], categoryId: "c1" });
  });

  it("sends the filter, not an id list, for select-all-shown", async () => {
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: wrapper() });
    await result.current.mutateAsync({
      filter: { bucket: "out", categoryIds: ["c9"] },
      addTagIds: ["t1"],
    });
    expect(lastBody()).toEqual({
      filter: { bucket: "out", categoryIds: "c9" },
      addTagIds: ["t1"],
    });
  });

  it("sends boolean filters as real JSON booleans, not the string \"true\"", async () => {
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: wrapper() });
    await result.current.mutateAsync({
      filter: { bucket: "out", uncategorized: true },
      checked: true,
    });
    const body = lastBody() as { filter: { uncategorized: unknown } };
    expect(body.filter.uncategorized).toBe(true);
    expect(typeof body.filter.uncategorized).toBe("boolean");
    expect(body).toEqual({ filter: { bucket: "out", uncategorized: true }, checked: true });
  });
});

describe("the list, the counts and select-all-shown read one filter", () => {
  // `Required` makes adding a filter field without setting it here a type
  // error, so a new field cannot slip past this comparison.
  const EVERY_FIELD: Required<TransactionFilterQuery> = {
    search: "leclerc",
    accountId: "acc-1",
    bucket: "out",
    from: "2026-01-01",
    to: "2026-01-31",
    categoryIds: ["c1", "c2"],
    tagIds: ["t1"],
    uncategorized: true,
    needsReview: true,
    includeTransfers: true,
  };

  function queryOf(url: string): Record<string, string> {
    const params = new URLSearchParams(url.split("?")[1]);
    params.delete("limit");
    params.delete("offset");
    return Object.fromEntries(params);
  }

  it("sends every list field to bulk, with the same values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    renderHook(() => useTransactions(EVERY_FIELD), { wrapper: wrapper() });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const list = queryOf(lastUrl());
    expect(Object.keys(list)).toHaveLength(Object.keys(EVERY_FIELD).length);

    vi.stubGlobal("fetch", vi.fn(async () => json({ matching: 0, total: 0, uncategorized: 0 })));
    renderHook(() => useTransactionCounts(EVERY_FIELD), { wrapper: wrapper() });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(queryOf(lastUrl())).toEqual(list);

    vi.stubGlobal("fetch", vi.fn(async () => json({ updated: 0 })));
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: wrapper() });
    await result.current.mutateAsync({ filter: EVERY_FIELD, checked: true });
    const bulk = (lastBody() as { filter: Record<string, unknown> }).filter;
    const bulkAsQuery = Object.fromEntries(Object.entries(bulk).map(([k, v]) => [k, String(v)]));
    expect(bulkAsQuery).toEqual(list);
  });

  it("carries include-transfers into a select-all write", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ updated: 0 })));
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: wrapper() });
    await result.current.mutateAsync({ filter: { includeTransfers: true }, categoryId: "c1" });
    expect(lastBody()).toEqual({ filter: { includeTransfers: true }, categoryId: "c1" });
  });
});

describe("what a row write refreshes", () => {
  function clientWith() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(keys.transactions({}), { pages: [], pageParams: [] });
    client.setQueryData(keys.transactionCounts({}), {});
    client.setQueryData(keys.budgetSummary({ mode: "month", month: "2026-09" }), {});
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    return { client, Wrapper, stale };
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ sameDescriptionCount: 0, updated: 1 })));
  });

  it("a ✓ toggle refreshes the rows only", async () => {
    const { Wrapper, stale } = clientWith();
    const { result } = renderHook(() => usePatchTransaction(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: "tx-1", body: { checked: true } });
    expect(stale(keys.transactions({}))).toBe(true);
    expect(stale(keys.transactionCounts({}))).toBe(false);
    expect(stale(keys.budgetSummary({ mode: "month", month: "2026-09" }))).toBe(false);
  });

  it("a bulk ✓ refreshes the rows only", async () => {
    const { Wrapper, stale } = clientWith();
    const { result } = renderHook(() => useBulkTransactions(), { wrapper: Wrapper });
    await result.current.mutateAsync({ ids: ["a"], checked: true });
    expect(stale(keys.transactions({}))).toBe(true);
    expect(stale(keys.budgetSummary({ mode: "month", month: "2026-09" }))).toBe(false);
  });

  it("a category write refreshes the counts and the figures too", async () => {
    const { Wrapper, stale } = clientWith();
    const { result } = renderHook(() => usePatchTransaction(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: "tx-1", body: { categoryId: "c1", checked: true } });
    expect(stale(keys.transactionCounts({}))).toBe(true);
    expect(stale(keys.budgetSummary({ mode: "month", month: "2026-09" }))).toBe(true);
  });
});
