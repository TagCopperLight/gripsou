import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  afterAccountEdit,
  afterBudgetCategoryChange,
  afterBudgetTagChange,
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
    ]);
  });
});

describe("afterLotsSaved", () => {
  it("refreshes the derived history plus that holding's own lots and prices", () => {
    expect(invalidatedBy((qc) => afterLotsSaved(qc, "h1"))).toEqual([
      ["holdings"],
      ["transactions"],
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
});

it("a finished sync refreshes the transaction counts too", () => {
  const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
  afterSyncFinished(qc);
  const keysCalled = (qc.invalidateQueries as Mock).mock.calls.map((c) => c[0].queryKey);
  expect(keysCalled).toContainEqual(keys.transactionCounts());
});
