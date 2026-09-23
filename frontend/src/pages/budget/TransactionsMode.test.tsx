import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TransactionsMode } from "./TransactionsMode";
import { BudgetProvider } from "../../components/budget/BudgetProvider";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";
import type { Transaction } from "../../api/types";

const CATEGORIES = [
  {
    id: "gro", name: "Groceries", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 3,
  },
];

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t1", t: Date.UTC(2026, 8, 12, 12), type: "withdrawal", description: "ALDI",
    amount: "-12.40", amountReporting: "-12.40", currency: "EUR", accountId: "a", accountName: "Current",
    accountColor: null, source: "cash", ticker: null, quantity: null, unitPrice: null,
    fee: null, categoryId: null, categoryName: null, categoryDefaultKey: null,
    categoryColor: null, categoryIcon: null, categoryKind: null, categorySource: null,
    categoryConfidence: null, needsReview: false, checked: false, isTransfer: false,
    isOrphanTransfer: false,
    tags: [], ...over,
  };
}

const TAGS = [
  { id: "A", name: "Alpha", color: "#9bb06b" },
  { id: "B", name: "Bravo", color: "#5b9bf0" },
  { id: "C", name: "Charlie", color: "#f0b952" },
];

const ROWS = [tx({ id: "t1", tags: [TAGS[0]] }), tx({ id: "t2", description: "SNCF" })];

let patchBodies: unknown[] = [];
let bulkBodies: unknown[] = [];
let applyBodies: unknown[] = [];
let sameDescriptionCount = 0;
// What the bulk and apply-to-description endpoints report back as the number
// of internal-transfer pairs an unconfirmed write would dissolve. 0 means the
// write goes straight through, which is every other test in this file.
let pendingPairBreaks = 0;
// Forces the row-patch endpoint to fail, to exercise `usePatchTransaction`'s
// rollback — every other test in this file only ever sees a 200.
let patchShouldFail = false;
// Forces the bulk endpoint to fail, to exercise the inline error banner.
let bulkShouldFail = false;
// Mutable server-side state for `t1`'s tags, kept in sync with accepted
// PATCHes so a post-mutation refetch (`onSettled` invalidation) returns what
// the "server" actually holds — exactly like the real backend — instead of
// silently reverting an accepted write back to the fixture's initial tags.
let serverRowsState: Transaction[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorJson(status = 500) {
  return new Response(JSON.stringify({ error: "boom" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (u.includes("/budget/categories")) return json(CATEGORIES);
      if (u.includes("/budget/tags")) return json(TAGS);
      if (u.includes("/transactions/counts")) {
        return json({ matching: 2, total: 2, uncategorized: 2, matchingTotal: "-999.00" });
      }
      if (u.includes("/apply-to-description")) {
        applyBodies.push(body);
        const confirmed = (body as { confirmBreakPairs?: boolean } | undefined)?.confirmBreakPairs;
        if (pendingPairBreaks > 0 && !confirmed) {
          return json({ updated: 0, pendingPairBreaks });
        }
        return json({ updated: 4 });
      }
      if (u.includes("/transactions/bulk")) {
        bulkBodies.push(body);
        if (bulkShouldFail) return errorJson();
        const confirmed = (body as { confirmBreakPairs?: boolean } | undefined)?.confirmBreakPairs;
        if (pendingPairBreaks > 0 && !confirmed) {
          return json({ updated: 0, pendingPairBreaks });
        }
        return json({ updated: 2 });
      }
      if (/\/transactions\/[^/?]+$/.test(u) && init?.method === "PATCH") {
        patchBodies.push(body);
        if (patchShouldFail) return errorJson();
        const match = u.match(/\/transactions\/([^/?]+)$/);
        const id = match?.[1];
        if (id && body && typeof body === "object" && "tagIds" in (body as Record<string, unknown>)) {
          const tagIds = (body as { tagIds: string[] }).tagIds;
          serverRowsState = serverRowsState.map((r) =>
            r.id === id ? { ...r, tags: tagIds.map((tid) => TAGS.find((tg) => tg.id === tid)!) } : r,
          );
        }
        return json({ sameDescriptionCount });
      }
      if (u.includes("/transactions")) return json(serverRowsState);
      return json([]);
    }),
  );
}

// Same stub-provider pattern as `pages/settings/Budget.test.tsx`: a plain
// object cast to `AuthValue`, since these tests never exercise a prefs write.
function authValue(prefs = DEFAULT_PREFS): AuthValue {
  return { prefs, updatePrefs: vi.fn(async () => {}) } as unknown as AuthValue;
}

function renderMode(prefs = DEFAULT_PREFS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authValue(prefs)}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  }
  render(
    <BudgetProvider>
      <TransactionsMode />
    </BudgetProvider>,
    { wrapper: Wrapper },
  );
  return client;
}

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(client.isMutating()).toBe(0));
}

describe("TransactionsMode", () => {
  beforeEach(() => {
    patchBodies = [];
    bulkBodies = [];
    applyBodies = [];
    sameDescriptionCount = 0;
    pendingPairBreaks = 0;
    patchShouldFail = false;
    bulkShouldFail = false;
    serverRowsState = ROWS.map((r) => ({ ...r, tags: [...r.tags] }));
    stubFetch();
  });

  it("assigns a category from a row and sends only that field", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await waitFor(() => expect(patchBodies).toEqual([{ categoryId: "gro" }]));
    await settle(client);
  });

  it("offers applying the correction to the rows sharing the description", async () => {
    sameDescriptionCount = 4;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    const prompt = await screen.findByTestId("apply-to-all");
    expect(prompt).toHaveTextContent("4");
    fireEvent.click(screen.getByTestId("apply-to-all-confirm"));
    await waitFor(() => expect(applyBodies).toEqual([{ categoryId: "gro" }]));
    await settle(client);
  });

  it("declining the apply-to-all offer sends no further request", async () => {
    sameDescriptionCount = 4;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await screen.findByTestId("apply-to-all");
    // The row's own patch already went through — this offer is only about
    // widening the fix, so declining it must not touch the network again.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("apply-to-all")).toBeNull());
    await settle(client);
    expect(patchBodies).toEqual([{ categoryId: "gro" }]);
    expect(applyBodies).toEqual([]);
  });

  it("rolls the row's chip back when the category write fails", async () => {
    patchShouldFail = true;
    const client = renderMode();
    await screen.findByText("ALDI");
    // Before the write, the row is uncategorised.
    expect(screen.getAllByTestId("category-chip")[0]).toHaveAttribute(
      "data-variant",
      "uncategorized",
    );
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    // The request was actually sent (and rejected)...
    await waitFor(() => expect(patchBodies).toEqual([{ categoryId: "gro" }]));
    await settle(client);
    // ...and once the failed mutation has settled, the chip is back to
    // uncategorised rather than stuck on the optimistic "Groceries" value —
    // the user must never be shown a write that the server rejected.
    expect(screen.getAllByTestId("category-chip")[0]).toHaveAttribute(
      "data-variant",
      "uncategorized",
    );
  });

  it("does not offer it when no other row shares the description", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(screen.queryByTestId("apply-to-all")).toBeNull();
    await settle(client);
  });

  it("bulk-assigns hand-picked rows by id", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-select")[0]);
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await waitFor(() => expect(bulkBodies).toEqual([{ ids: ["t1"], categoryId: "gro" }]));
    await settle(client);
  });

  it("shows the checked column when the preference is on", async () => {
    const client = renderMode({ ...DEFAULT_PREFS, showChecked: true });
    await screen.findByText("ALDI");
    expect(screen.getAllByTestId("tx-checked")).toHaveLength(ROWS.length);
    await settle(client);
  });

  it("bulk-assigns by filter for select-all-shown", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getByTestId("select-all-shown"));
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await waitFor(() => expect(bulkBodies).toHaveLength(1));
    expect(bulkBodies[0]).toMatchObject({ categoryId: "gro" });
    expect(bulkBodies[0]).toHaveProperty("filter");
    expect(bulkBodies[0]).not.toHaveProperty("ids");
    await settle(client);
  });

  it("wires the selection bar's total to the server's matchingTotal for select-all-shown (M9)", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getByTestId("select-all-shown"));
    await waitFor(() =>
      expect(screen.getByTestId("selection-total")).toHaveTextContent("999,00"),
    );
    await settle(client);
  });

  it("wires the selection bar's total to the exact sum of the id-selected rows (M9)", async () => {
    // Both fixture rows carry amountReporting "-12.40" — a hand-picked
    // selection of both must show their exact sum, not the server's
    // matchingTotal (which the stub sets to a different, unrelated value).
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-select")[0]);
    fireEvent.click(screen.getAllByTestId("tx-select")[1]);
    await waitFor(() =>
      expect(screen.getByTestId("selection-total")).toHaveTextContent("24,80"),
    );
    expect(screen.getByTestId("selection-total")).not.toHaveTextContent("999");
    await settle(client);
  });

  it("accumulates every toggle against the live row, not a frozen snapshot", async () => {
    // t1 starts with tag A. Opening the chooser and toggling B then C must
    // each patch against the CURRENT tag set (including whatever the previous
    // toggle's optimistic update just added) — not the row as it looked the
    // instant the chooser opened. A regression here silently destroys tags:
    // see CRITICAL finding 1.
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-add-tag")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-B"));
    await waitFor(() => expect(patchBodies).toEqual([{ tagIds: ["A", "B"] }]));
    fireEvent.click(await screen.findByTestId("chooser-option-C"));
    await waitFor(() =>
      expect(patchBodies).toEqual([{ tagIds: ["A", "B"] }, { tagIds: ["A", "B", "C"] }]),
    );
    await settle(client);
  });

  it("toggling an existing tag off sends the set without it", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-add-tag")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-A"));
    await waitFor(() => expect(patchBodies).toEqual([{ tagIds: [] }]));
    await settle(client);
  });

  it("surfaces a dismissible inline error when a row write fails", async () => {
    patchShouldFail = true;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await settle(client);
    expect(screen.getByTestId("write-error")).toHaveTextContent(
      "That change could not be saved. Please try again.",
    );
    fireEvent.click(screen.getByTestId("write-error-dismiss"));
    expect(screen.queryByTestId("write-error")).toBeNull();
  });

  it("surfaces a dismissible inline error when a bulk write fails", async () => {
    bulkShouldFail = true;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getByTestId("select-all-shown"));
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await settle(client);
    expect(screen.getByTestId("write-error")).toBeVisible();
    fireEvent.click(screen.getByTestId("write-error-dismiss"));
    expect(screen.queryByTestId("write-error")).toBeNull();
  });

  it("reports how many rows a successful bulk write touched", async () => {
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-select")[0]);
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await settle(client);
    expect(screen.getByTestId("bulk-result")).toHaveTextContent("2");
  });

  // -------------------------------------------------------------------------
  // Breaking an internal-transfer pair
  //
  // Recategorising half of an auto-paired transfer dissolves the pair on both
  // sides. That is destructive enough to confirm, and the count can only come
  // from the server for a bulk write, whose target set the client may never
  // have loaded.
  // -------------------------------------------------------------------------

  it("confirms before recategorising half of an auto-paired transfer", async () => {
    serverRowsState = [tx({ id: "t1", isTransfer: true })];
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));

    await screen.findByTestId("break-pair-modal");
    expect(patchBodies).toEqual([]);

    fireEvent.click(screen.getByTestId("break-pair-confirm"));
    await waitFor(() => expect(patchBodies).toEqual([{ categoryId: "gro" }]));
    await settle(client);
  });

  it("writes nothing when the pair-break confirmation is declined", async () => {
    serverRowsState = [tx({ id: "t1", isTransfer: true })];
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await screen.findByTestId("break-pair-modal");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("break-pair-modal")).toBeNull());
    await settle(client);
    expect(patchBodies).toEqual([]);
  });

  it("re-sends a bulk write with confirmation once the server reports pair breaks", async () => {
    pendingPairBreaks = 3;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-select")[0]);
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));

    // The first attempt came back refused, not applied.
    const modal = await screen.findByTestId("break-pair-modal");
    expect(modal).toHaveTextContent("3");
    expect(bulkBodies).toEqual([{ ids: ["t1"], categoryId: "gro" }]);

    fireEvent.click(screen.getByTestId("break-pair-confirm"));
    await waitFor(() => expect(bulkBodies).toHaveLength(2));
    expect(bulkBodies[1]).toEqual({ ids: ["t1"], categoryId: "gro", confirmBreakPairs: true });
    await settle(client);
  });

  it("does not report a refused bulk write as rows updated", async () => {
    pendingPairBreaks = 3;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("tx-select")[0]);
    fireEvent.click(screen.getByLabelText(/assign a category/i));
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    await screen.findByTestId("break-pair-modal");

    expect(screen.queryByTestId("bulk-updated")).toBeNull();
    await settle(client);
  });

  it("confirms before an apply-to-description breaks pairs", async () => {
    sameDescriptionCount = 4;
    pendingPairBreaks = 2;
    const client = renderMode();
    await screen.findByText("ALDI");
    fireEvent.click(screen.getAllByTestId("category-chip")[0]);
    fireEvent.click(await screen.findByTestId("chooser-option-gro"));
    fireEvent.click(await screen.findByTestId("apply-to-all-confirm"));

    const modal = await screen.findByTestId("break-pair-modal");
    expect(modal).toHaveTextContent("2");

    fireEvent.click(screen.getByTestId("break-pair-confirm"));
    await waitFor(() => expect(applyBodies).toHaveLength(2));
    expect(applyBodies[1]).toEqual({ categoryId: "gro", confirmBreakPairs: true });
    await settle(client);
  });
});
