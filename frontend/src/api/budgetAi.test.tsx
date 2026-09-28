import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useAiStatus,
  useRequestCategorize,
  useSetBudgetAiSettings,
  useUndoReview,
  type AiStatus,
} from "./budget";
import { keys } from "./keys";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function stub(body: unknown, status = 200) {
  const empty = status === 204 || status === 202;
  const fetchMock = vi.fn(async () =>
    new Response(empty ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("budget AI client", () => {
  it("reads the run status", async () => {
    stub({ configured: true, running: false, remaining: 0, reviewCount: 3, lastRun: null });
    const { result } = renderHook(() => useAiStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.reviewCount).toBe(3));
  });

  it("sends the original guess back on undo", async () => {
    const fetchMock = stub(null, 204);
    const { result } = renderHook(() => useUndoReview(), { wrapper: wrapper() });
    await result.current.mutateAsync({ id: "t1", categoryId: "c1", confidence: "0.40" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/budget/review/t1/undo");
    expect(JSON.parse(String(init.body))).toEqual({ categoryId: "c1", confidence: "0.40" });
  });

  it("accepts an empty 202 when a run is requested", async () => {
    const fetchMock = stub(null, 202);
    const { result } = renderHook(() => useRequestCategorize(), { wrapper: wrapper() });
    await expect(result.current.mutateAsync()).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("/budget/categorize");
  });

  it("accepts an empty 204 when the admin saves the provider", async () => {
    const fetchMock = stub(null, 204);
    const { result } = renderHook(() => useSetBudgetAiSettings(), { wrapper: wrapper() });
    await expect(
      result.current.mutateAsync({ provider: "gemini", model: null }),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/settings/budget-ai");
    expect(init.method).toBe("PATCH");
  });
});

describe("refreshing as an AI run moves on", () => {
  let status: AiStatus;

  function setup() {
    status = { configured: true, running: true, remaining: 10, reviewCount: 0, lastRun: null };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(status)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    // Two readers at once, as the Budget page and its banner are.
    const { result } = renderHook(() => [useAiStatus(), useAiStatus()], { wrapper });
    const refreshed = (key: readonly unknown[]) =>
      spy.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(key)).length;
    const poll = async (next: Partial<AiStatus>) => {
      status = { ...status, ...next };
      await act(() => qc.refetchQueries({ queryKey: keys.budgetAiStatus() }));
    };
    return { result, spy, refreshed, poll };
  }

  it("refreshes the figures once per change, however many components read the status", async () => {
    const { result, refreshed, poll } = setup();
    await waitFor(() => expect(result.current[0].data?.remaining).toBe(10));

    await poll({ remaining: 8 });
    expect(refreshed(keys.budgetSummary())).toBe(1);

    // Nothing moved: nothing to refresh.
    await poll({});
    expect(refreshed(keys.budgetSummary())).toBe(1);
  });

  it("refreshes the list once when the run ends", async () => {
    const { result, refreshed, poll } = setup();
    await waitFor(() => expect(result.current[0].data?.running).toBe(true));

    await poll({ running: false, remaining: 0, reviewCount: 4 });
    expect(refreshed(keys.transactions())).toBe(1);
    expect(refreshed(keys.budgetSummary())).toBe(1);
  });

  it("does not refresh again after the user's own write when no run is going", async () => {
    const { result, spy, poll } = setup();
    status = { ...status, running: false, remaining: 0 };
    await waitFor(() => expect(result.current[0].data).toBeDefined());
    await poll({});
    spy.mockClear();

    // An accept moves the queue count; its own mutation already refreshed.
    await poll({ reviewCount: 2 });
    expect(spy).not.toHaveBeenCalled();
  });
});
