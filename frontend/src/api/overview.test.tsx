import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useBudgetSummary, useBudgetTrend } from "./overview";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ months: [], series: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBudgetSummary", () => {
  it("sends `month` alone in month mode", async () => {
    renderHook(() => useBudgetSummary({ mode: "month", month: "2026-09" }), { wrapper });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain("month=2026-09");
    // Either `month` or `from`+`to`, never both — both is a 400.
    expect(calls[0]).not.toContain("from=");
    expect(calls[0]).not.toContain("to=");
  });

  it("sends `from` and `to` alone in range mode", async () => {
    renderHook(
      () => useBudgetSummary({ mode: "range", from: "2026-01-01", to: "2026-03-31" }),
      { wrapper },
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain("from=2026-01-01");
    expect(calls[0]).toContain("to=2026-03-31");
    expect(calls[0]).not.toContain("month=");
  });
});

describe("useBudgetTrend", () => {
  it("sends the anchor and a twelve-month window by default", async () => {
    renderHook(() => useBudgetTrend("2026-09"), { wrapper });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain("anchor=2026-09");
    expect(calls[0]).toContain("months=12");
  });
});
