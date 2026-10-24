import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useAccounts, useAccountSeries, useConnections, useHoldings,
  useInvestmentReturns, useNetWorth, useSyncConnection, useTransactions,
} from "./hooks";
import { useAiStatus, type AiStatus } from "./budget";
import { setAuthToken } from "./client";
import {
  afterAccountEdit, afterAiRunFinished, afterBudgetCategoryChange,
  afterReviewChange, afterSyncFinished, afterTransactionChange,
} from "./invalidate";
import { keys } from "./keys";
import type { ProviderGroup, SyncStatus } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAuthToken(null);
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function connection(id: string, status: SyncStatus, lastSyncAt: number | null) {
  return { id, status, lastSyncAt, displayName: id, lastError: null, accounts: [], logo: null };
}

function groups(...connections: ProviderGroup["connections"]): ProviderGroup[] {
  return [{ providerKey: "p", providerName: "P", connections }];
}

describe("portfolio navigation cache", () => {
  const cases = [
    ["net worth", () => useNetWorth("1y"), {
      points: [], summary: { netWorth: "0", invested: "0", gainAbs: "0", gainPct: "0", fxMissing: false, reportingFxMissing: false },
    }],
    ["holdings", useHoldings, []],
    ["accounts", useAccounts, []],
    ["account history", () => useAccountSeries("1y"), { accounts: [], points: [] }],
    ["investment returns", useInvestmentReturns, {
      today: "2026-01-15", total: { annualised: null, since: null, invested: "0", value: "0", gl: "0", glPct: "0" }, accounts: [],
    }],
  ] as const;

  it.each(cases)("reuses fresh %s on navigation and refreshes after sync", async (_name, query, body) => {
    const { qc, wrapper } = setup();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { reads++; return Response.json(body); }));
    const first = renderHook(() => query(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const next = renderHook(() => query(), { wrapper });
    try {
      expect(next.result.current.data).toEqual(body);
      expect(next.result.current.isFetching).toBe(false);
      expect(reads).toBe(1);
      await act(() => afterSyncFinished(qc));
      expect(reads).toBe(2);
    } finally { next.unmount(); qc.clear(); }
  });

  it.each(cases)("refetches %s when returning after the freshness window", async (_name, query, body) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { qc, wrapper } = setup();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { reads++; return Response.json(body); }));
    const first = renderHook(() => query(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    vi.setSystemTime(Date.now() + 30_001);
    const next = renderHook(() => query(), { wrapper });
    try {
      await waitFor(() => expect(next.result.current.isFetching).toBe(false));
      expect(reads).toBe(2);
    } finally { next.unmount(); qc.clear(); }
  });
});

describe("sync completion", () => {
  it("refreshes a requested sync that finished before the first connection snapshot arrived", async () => {
    const { qc, wrapper } = setup();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ status: "syncing" }, { status: 202 });
      if (++reads === 1) return new Promise<Response>(() => {});
      return Response.json(groups(connection("a", "ok", 2000)));
    }));
    const { result, unmount } = renderHook(() => ({ connections: useConnections(), sync: useSyncConnection() }), { wrapper });
    try {
      await waitFor(() => expect(reads).toBe(1));
      qc.setQueryData(keys.transactions({}), { pages: [[]], pageParams: [0] });
      await act(() => result.current.sync.mutateAsync("a"));
      expect(qc.getQueryState(keys.transactions({}))?.isInvalidated).toBe(true);
    } finally { unmount(); qc.clear(); }
  });
  it.each([
    ["a normally observed sync", groups(connection("a", "syncing", 1000)), groups(connection("a", "ok", 2000))],
    ["a sync whose running state was missed", groups(connection("a", "ok", 1000)), groups(connection("a", "ok", 2000))],
    ["one connection finishing while another runs", groups(connection("a", "syncing", 1000), connection("b", "syncing", 1000)), groups(connection("a", "ok", 2000), connection("b", "syncing", 1000))],
    ["a new connection whose first sync already finished", groups(connection("a", "ok", 1000)), groups(connection("a", "ok", 1000), connection("b", "ok", 2000))],
    ["a failed sync that may have committed data", groups(connection("a", "syncing", 1000)), groups(connection("a", "error", 1000))],
  ])("refreshes transactions after %s", async (_name, before, after) => {
    const { qc, wrapper } = setup();
    let connections = before;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(connections)));
    qc.setQueryData(keys.transactions({}), { pages: [[]], pageParams: [0] });
    const { result, unmount } = renderHook(() => useConnections(), { wrapper });
    try {
      await waitFor(() => expect(result.current.data).toEqual(before));
      connections = after;
      await act(() => result.current.refetch());
      await waitFor(() => expect(qc.getQueryState(keys.transactions({}))?.isInvalidated).toBe(true));
    } finally { unmount(); qc.clear(); }
  });

  it("does not refresh again for an unchanged completed connection", async () => {
    const { qc, wrapper } = setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(groups(connection("a", "ok", 1000)))));
    const { result, unmount } = renderHook(() => useConnections(), { wrapper });
    try {
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      qc.setQueryData(keys.holdings(), []);
      await act(() => result.current.refetch());
      expect(qc.getQueryState(keys.holdings())?.isInvalidated).toBe(false);
    } finally { unmount(); qc.clear(); }
  });

  it("discovers a background sync while the page stays idle", async () => {
    vi.useFakeTimers();
    const { qc, wrapper } = setup();
    let connections = groups(connection("a", "ok", 1000));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(connections)));
    const { result, unmount } = renderHook(() => useConnections(), { wrapper });
    try {
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(result.current.isSuccess).toBe(true);
      qc.setQueryData(keys.holdings(), []);
      connections = groups(connection("a", "ok", 2000));
      await act(() => vi.advanceTimersByTimeAsync(30_100));
      expect(qc.getQueryState(keys.holdings())?.isInvalidated).toBe(true);
    } finally { unmount(); qc.clear(); }
  });
});

describe("AI completion", () => {
  const idle: AiStatus = { configured: true, running: false, remaining: 1, reviewCount: 0, lastRun: null };

  it("discovers a completed run without having seen it running", async () => {
    vi.useFakeTimers();
    const { qc, wrapper } = setup();
    let status = idle;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(status)));
    const { result, unmount } = renderHook(() => useAiStatus(), { wrapper });
    try {
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(result.current.isSuccess).toBe(true);
      qc.setQueryData(keys.transactions({}), { pages: [[]], pageParams: [0] });
      status = { ...idle, remaining: 0, reviewCount: 1, lastRun: { outcome: "ok", error: null, startedAt: "2026-10-09T00:00:00Z" } };
      await act(() => vi.advanceTimersByTimeAsync(30_100));
      expect(qc.getQueryState(keys.transactions({}))?.isInvalidated).toBe(true);
    } finally { unmount(); qc.clear(); }
  });

  it("refetches transaction categories after completion even when an older response is still arriving", async () => {
    const { qc, wrapper } = setup();
    let status = { ...idle, running: true };
    let requests = 0;
    let release!: (response: Response) => void;
    const slow = new Promise<Response>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/budget/categorize/status")) return Response.json(status);
      requests++;
      if (requests === 2) return slow;
      return Response.json([{ id: "t1", categoryId: requests > 2 ? "groceries" : null }]);
    }));
    const { result, unmount } = renderHook(() => ({ ai: useAiStatus(), list: useTransactions({}) }), { wrapper });
    try {
      await waitFor(() => {
        expect(result.current.ai.data?.running).toBe(true);
        expect(result.current.list.data?.pages[0][0].categoryId).toBeNull();
      });
      let pending!: Promise<void>;
      act(() => { pending = qc.refetchQueries({ queryKey: keys.transactions() }); });
      await waitFor(() => expect(requests).toBe(2));
      status = { ...idle, remaining: 0, reviewCount: 1 };
      await act(() => qc.refetchQueries({ queryKey: keys.budgetAiStatus() }));
      await act(async () => { release(Response.json([{ id: "t1", categoryId: null }])); await pending; });
      await waitFor(() => expect(result.current.list.data?.pages[0][0].categoryId).toBe("groceries"));
    } finally { unmount(); qc.clear(); }
  });
});

describe("mutation dependencies", () => {
  it("aborts the HTTP request when a superseded query is cancelled", async () => {
    const { qc, wrapper } = setup();
    let signal: AbortSignal | null | undefined;
    let started = false;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal;
      started = true;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }));
    const { unmount } = renderHook(() => useHoldings(), { wrapper });
    try {
      await waitFor(() => expect(started).toBe(true));
      await act(() => qc.cancelQueries({ queryKey: keys.holdings() }));
      expect(signal?.aborted).toBe(true);
    } finally { unmount(); qc.clear(); }
  });
  it.each([
    ["sync", afterSyncFinished, [keys.holdingPrices("h", "1y"), keys.holdingLots("h"), keys.holdingLotSuggestions("h")]],
    ["account edit", afterAccountEdit, [keys.connections()]],
    ["transaction edit", afterTransactionChange, [keys.budgetCategories(), keys.budgetTags()]],
    ["review undo", afterReviewChange, [keys.budgetCategories()]],
    ["AI completion", afterAiRunFinished, [keys.budgetCategories()]],
  ])("marks cached dependants stale after %s", async (_name, event, dependants) => {
    const qc = new QueryClient();
    try {
      for (const key of dependants) qc.setQueryData(key, []);
      await event(qc);
      for (const key of dependants) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    } finally { qc.clear(); }
  });

  it("restarts an initial read that began before a transaction write", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: (value: string) => void;
    const old = new Promise<string>((resolve) => { release = resolve; });
    let reads = 0;
    const observer = new QueryObserver(qc, { queryKey: keys.budgetCategories(), queryFn: () => ++reads === 1 ? old : Promise.resolve("fresh") });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await afterBudgetCategoryChange(qc);
      release("old");
      await waitFor(() => expect(observer.getCurrentResult().data).toBe("fresh"));
    } finally { unsubscribe(); qc.clear(); }
  });
});
