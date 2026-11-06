import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useAiStatus, useRequestCategorize, useSetBudgetAiSettings, useUndoReview } from "./budget";
import { useBudgetSummary } from "./overview";
import { useTransactions } from "./transactions";
import type { AiStatus } from "./wire";
import { keys } from "./keys";
import { appWrapper, requestsTo, stubFetch } from "../test/kit";

function stub(body: unknown, status = 200) {
  const empty = status === 204 || status === 202;
  const fetchMock = stubFetch(async () =>
    new Response(empty ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }));
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("budget AI client", () => {
  it("sends the original guess back on undo", async () => {
    const fetchMock = stub(null, 204);
    const { result } = renderHook(() => useUndoReview(), appWrapper());
    await result.current.mutateAsync({ id: "t1", categoryId: "c1", confidence: "0.40" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/budget/review/t1/undo");
    expect(JSON.parse(String(init.body))).toEqual({ categoryId: "c1", confidence: "0.40" });
  });

  it("accepts an empty 202 when a run is requested", async () => {
    const fetchMock = stub(null, 202);
    const { result } = renderHook(() => useRequestCategorize(), appWrapper());
    await expect(result.current.mutateAsync()).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("/budget/categorize");
  });

  it("accepts an empty 204 when the admin saves the provider", async () => {
    const fetchMock = stub(null, 204);
    const { result } = renderHook(() => useSetBudgetAiSettings(), appWrapper());
    await expect(
      result.current.mutateAsync({ provider: "jev", model: null }),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/settings/budget-ai");
    expect(init.method).toBe("PATCH");
  });
});

describe("refreshing as an AI run moves on", () => {
  const SEPTEMBER = { mode: "month", month: "2026-09" } as const;
  let status: AiStatus;
  let holdSummary: Promise<void> | null;

  function setup() {
    status = { configured: true, running: true, remaining: 10, reviewCount: 0, lastRun: null };
    holdSummary = null;
    const fetchMock = stubFetch(async (url: string) => {
      if (url.includes("/budget/categorize/status")) return Response.json(status);
      if (url.includes("/budget/summary")) {
        if (holdSummary) await holdSummary;
        return Response.json({});
      }
      return Response.json([]);
    });
    const { client: qc, wrapper } = appWrapper();
    // Two status readers at once, as the Budget page and its banner are,
    // beside the figures and the transaction list.
    const { result } = renderHook(() => ({
      statuses: [useAiStatus(), useAiStatus()],
      summary: useBudgetSummary(SEPTEMBER),
      list: useTransactions({}),
    }), { wrapper });
    const reads = (path: string) => requestsTo(fetchMock, path).length;
    const poll = async (next: Partial<AiStatus>) => {
      status = { ...status, ...next };
      await act(() => qc.refetchQueries({ queryKey: keys.budgetAiStatus() }));
      await waitFor(() => expect(qc.isFetching()).toBe(0));
    };
    const loaded = () => waitFor(() => {
      expect(result.current.statuses[0].data).toBeDefined();
      expect(result.current.list.isSuccess).toBe(true);
    });
    return { qc, result, reads, poll, loaded };
  }

  it("refetches the figures once per change, however many components read the status", async () => {
    const { reads, poll, loaded } = setup();
    await loaded();
    await waitFor(() => expect(reads("/budget/summary")).toBe(1));

    await poll({ remaining: 8 });
    expect(reads("/budget/summary")).toBe(2);

    // Nothing moved: nothing to refresh.
    await poll({});
    expect(reads("/budget/summary")).toBe(2);
  });

  it("only marks the list stale while the run goes on, and refetches it once when it ends", async () => {
    const { qc, reads, poll, loaded } = setup();
    await loaded();

    await poll({ remaining: 8 });
    expect(reads("/transactions")).toBe(1);
    expect(qc.getQueryState(keys.transactions({}))?.isInvalidated).toBe(true);

    await poll({ running: false, remaining: 0, reviewCount: 4 });
    expect(reads("/transactions")).toBe(2);
  });

  it("lets a figures read already in flight finish instead of starting it again", async () => {
    const { qc, result, reads, loaded } = setup();
    await loaded();
    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    let release!: () => void;
    holdSummary = new Promise((r) => { release = r; });
    const inFlight = qc.refetchQueries({ queryKey: keys.budgetSummary() });
    await waitFor(() => expect(reads("/budget/summary")).toBe(2));

    status = { ...status, remaining: 8 };
    await act(() => qc.refetchQueries({ queryKey: keys.budgetAiStatus() }));
    await waitFor(() => expect(result.current.statuses[0].data?.remaining).toBe(8));
    expect(reads("/budget/summary")).toBe(2);
    await act(async () => { release(); await inFlight; });
  });

  it("does not refresh again after the user's own write when no run is going", async () => {
    const { reads, poll, loaded } = setup();
    status = { ...status, running: false, remaining: 0 };
    await loaded();
    await poll({});
    const before = [reads("/budget/summary"), reads("/transactions")];

    // An accept moves the queue count; its own mutation already refreshed.
    await poll({ reviewCount: 2 });
    expect([reads("/budget/summary"), reads("/transactions")]).toEqual(before);
  });
});
