import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { afterAiRunFinished, afterAiRunProgress } from "./invalidate";

describe("a background AI run", () => {
  async function calls(run: (qc: QueryClient) => unknown) {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await run(qc);
    return spy.mock.calls.map(([filters, options]) => ({
      key: filters?.queryKey,
      refetchType: filters?.refetchType,
      cancelRefetch: options?.cancelRefetch,
    }));
  }

  it("refetches the figures while it runs, and only marks the list stale", async () => {
    const got = await calls(afterAiRunProgress);
    expect(got.map((c) => c.key)).toEqual([
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-usage"],
      ["transactions"],
      ["transaction-counts"],
    ]);
    expect(got.filter((c) => c.refetchType === "none").map((c) => c.key)).toEqual([
      ["transactions"],
      ["transaction-counts"],
    ]);
    // Never restart a fetch already in flight.
    expect(got.every((c) => c.cancelRefetch === false)).toBe(true);
  });

  it("refetches the list too once it ends, but not the status it was read from", async () => {
    const got = await calls(afterAiRunFinished);
    expect(got.map((c) => c.key)).toEqual([
      ["budget-categories"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-usage"],
    ]);
    expect(got.every((c) => c.refetchType !== "none")).toBe(true);
  });
});
