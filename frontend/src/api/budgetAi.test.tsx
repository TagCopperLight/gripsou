import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAiStatus, useRequestCategorize, useUndoReview } from "./budget";
import { useSetBudgetAiSettings } from "./hooks";

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
    stub({ configured: true, enabled: true, running: false, remaining: 0, reviewCount: 3, threshold: 80, lastRun: null });
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
