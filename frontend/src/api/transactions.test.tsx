import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useTransactions, useTransactionCounts } from "./hooks";
import { usePatchTransaction, useApplyToDescription, useBulkTransactions } from "./budget";

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
