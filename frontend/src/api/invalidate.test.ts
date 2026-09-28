import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  afterAccountEdit,
  afterAiRunFinished,
  afterAiRunProgress,
  afterBudgetAiPricesChange,
  afterBudgetAiSettingsChange,
  afterBudgetCategoryChange,
  afterBudgetCategoryCreated,
  afterBudgetCategoryReorder,
  afterBudgetTagChange,
  afterBudgetTagCreated,
  afterCategorizeRequested,
  afterCheckedChange,
  afterReviewChange,
  afterReviewThresholdChange,
  afterConnectionDeleted,
  afterLotsSaved,
  afterSessionChange,
  afterSyncFinished,
  afterSyncRequested,
  afterTransactionChange,
  afterUserChange,
} from "./invalidate";
import { keys } from "./keys";

// Each group is pinned to its exact key set rather than a "contains" check:
// the bugs these guard (AUDIT.md C-17, C-18, Z-6) were all keys MISSING from a
// list, which a containment assertion cannot catch.
function invalidatedBy(run: (qc: QueryClient) => void): unknown[][] {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  run(qc);
  return spy.mock.calls.map((c) => c[0]?.queryKey as unknown[]);
}

describe("afterSyncFinished", () => {
  it("refreshes every synced-data view, transactions included (C-17)", () => {
    expect(invalidatedBy(afterSyncFinished)).toEqual([
      ["net-worth"],
      ["distribution"],
      ["accounts"],
      ["account-series"],
      ["holdings"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-categories"],
      ["budget-tags"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-status"],
    ]);
  });
});

describe("afterSyncRequested", () => {
  it("refreshes only the connections list — the sync itself is asynchronous", () => {
    expect(invalidatedBy(afterSyncRequested)).toEqual([["connections"]]);
  });
});

describe("afterAccountEdit", () => {
  it("refreshes the two tables that render the account's name and colour (C-18)", () => {
    const got = invalidatedBy(afterAccountEdit);
    expect(got).toEqual([
      ["accounts"],
      ["distribution"],
      ["account-series"],
      ["holdings"],
      ["transactions"],
      ["transaction-counts"],
    ]);
  });
});

describe("afterConnectionDeleted", () => {
  it("refreshes the connections list AND every figure the deleted accounts fed", () => {
    expect(invalidatedBy(afterConnectionDeleted)).toEqual([
      ["connections"],
      ["net-worth"],
      ["distribution"],
      ["accounts"],
      ["account-series"],
      ["holdings"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-categories"],
      ["budget-tags"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-status"],
    ]);
  });
});

describe("afterLotsSaved", () => {
  it("refreshes the derived history, the transaction counts that list lot rows, and that holding's own lots and prices", () => {
    expect(invalidatedBy((qc) => afterLotsSaved(qc, "h1"))).toEqual([
      ["holdings"],
      ["transactions"],
      ["transaction-counts"],
      ["net-worth"],
      ["account-series"],
      ["holding-lots", "h1"],
      ["holding-prices", "h1"],
    ]);
  });
});

describe("the single-key groups", () => {
  it("afterSessionChange refreshes sessions", () => {
    expect(invalidatedBy(afterSessionChange)).toEqual([["sessions"]]);
  });

  it("afterUserChange refreshes users", () => {
    expect(invalidatedBy(afterUserChange)).toEqual([["users"]]);
  });
});

describe("budget taxonomy changes", () => {
  it("refreshes categories and the transactions that render their chips", () => {
    expect(invalidatedBy(afterBudgetCategoryChange)).toEqual([
      ["budget-categories"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-status"],
    ]);
  });

  it("refreshes tags and the transactions that render their chips", () => {
    expect(invalidatedBy(afterBudgetTagChange)).toEqual([
      ["budget-tags"],
      ["transactions"],
      ["transaction-counts"],
    ]);
  });

  it("leaves the Overview alone — no surface there renders a tag", () => {
    expect(invalidatedBy(afterBudgetTagChange)).not.toContainEqual(["budget-summary"]);
  });

  it("a finished sync refreshes both budget families, whose txCounts it moves", () => {
    expect(invalidatedBy(afterSyncFinished)).toEqual([
      ["net-worth"],
      ["distribution"],
      ["accounts"],
      ["account-series"],
      ["holdings"],
      ["transactions"],
      ["transaction-counts"],
      ["budget-categories"],
      ["budget-tags"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-status"],
    ]);
  });
});

it("afterTransactionChange refreshes the list and its counts", () => {
  const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
  afterTransactionChange(qc);
  const keysCalled = (qc.invalidateQueries as Mock).mock.calls.map((c) => c[0].queryKey);
  expect(keysCalled).toContainEqual(keys.transactions());
  expect(keysCalled).toContainEqual(keys.transactionCounts());
  expect(keysCalled).toContainEqual(keys.budgetSummary());
  expect(keysCalled).toContainEqual(keys.budgetTrend());
  expect(keysCalled).toContainEqual(keys.budgetAiStatus());
});

it("afterReviewChange refreshes the review queue and every figure built on categories", () => {
  expect(invalidatedBy(afterReviewChange)).toEqual([
    ["budget-ai-status"],
    ["transactions"],
    ["transaction-counts"],
    ["budget-summary"],
    ["budget-trend"],
  ]);
});

it("a finished sync refreshes the transaction counts too", () => {
  const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
  afterSyncFinished(qc);
  const keysCalled = (qc.invalidateQueries as Mock).mock.calls.map((c) => c[0].queryKey);
  expect(keysCalled).toContainEqual(keys.transactionCounts());
});

// The groups below were each too broad once: they are pinned exactly, and the
// keys they must leave alone are named so a widening fails loudly.
describe("narrow budget groups", () => {
  const FIGURES = [["budget-summary"], ["budget-trend"], ["budget-ai-status"]];

  it("a new category or tag refreshes only its own list", () => {
    expect(invalidatedBy(afterBudgetCategoryCreated)).toEqual([["budget-categories"]]);
    expect(invalidatedBy(afterBudgetTagCreated)).toEqual([["budget-tags"]]);
  });

  it("a reorder leaves the transactions and the Overview alone", () => {
    const got = invalidatedBy(afterBudgetCategoryReorder);
    expect(got).toEqual([["budget-categories"]]);
    expect(got).not.toContainEqual(["transactions"]);
    for (const k of FIGURES) expect(got).not.toContainEqual(k);
  });

  it("a ✓ toggle leaves the counts, the figures and the AI status alone", () => {
    const got = invalidatedBy(afterCheckedChange);
    expect(got).toEqual([["transactions"]]);
    expect(got).not.toContainEqual(["transaction-counts"]);
    for (const k of FIGURES) expect(got).not.toContainEqual(k);
  });

  it("a threshold change refreshes what needs-review decides, and not the figures", () => {
    const got = invalidatedBy(afterReviewThresholdChange);
    expect(got).toEqual([["transactions"], ["transaction-counts"], ["budget-ai-status"]]);
    expect(got).not.toContainEqual(["budget-summary"]);
  });

  it("requesting a run refreshes only the status", () => {
    expect(invalidatedBy(afterCategorizeRequested)).toEqual([["budget-ai-status"]]);
  });

  it("the admin AI settings refresh the settings and the status; prices only the usage", () => {
    expect(invalidatedBy(afterBudgetAiSettingsChange)).toEqual([
      ["budget-ai-settings"],
      ["budget-ai-status"],
    ]);
    expect(invalidatedBy(afterBudgetAiPricesChange)).toEqual([["budget-ai-usage"]]);
  });
});

describe("a background AI run", () => {
  function calls(run: (qc: QueryClient) => void) {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    run(qc);
    return spy.mock.calls.map(([filters, options]) => ({
      key: filters?.queryKey,
      refetchType: filters?.refetchType,
      cancelRefetch: options?.cancelRefetch,
    }));
  }

  it("refetches the figures while it runs, and only marks the list stale", () => {
    const got = calls(afterAiRunProgress);
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

  it("refetches the list too once it ends, but not the status it was read from", () => {
    const got = calls(afterAiRunFinished);
    expect(got.map((c) => c.key)).toEqual([
      ["transactions"],
      ["transaction-counts"],
      ["budget-summary"],
      ["budget-trend"],
      ["budget-ai-usage"],
    ]);
    expect(got.every((c) => c.refetchType === "active")).toBe(true);
  });
});
