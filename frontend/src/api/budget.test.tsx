import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ApiError } from "./client";
import { keys } from "./keys";
import {
  useBudgetCategories,
  useBudgetTags,
  useCreateBudgetCategory,
  useUpdateBudgetCategory,
  useDeleteBudgetCategory,
  useReorderBudgetCategories,
  useCreateBudgetTag,
  useUpdateBudgetTag,
  useDeleteBudgetTag,
  type BudgetCategory,
  type BudgetTag,
  type CategoryBody,
  type TagBody,
} from "./budget";

const GROCERIES: BudgetCategory = {
  id: "c1",
  name: "Groceries",
  defaultKey: "groceries",
  color: "#9bb06b",
  icon: "shopping-cart",
  hint: null,
  kind: "expense",
  systemKey: null,
  archived: false,
  txCount: 12,
};

const BODY: CategoryBody = {
  name: "Groceries",
  color: "#9bb06b",
  icon: "shopping-cart",
  hint: null,
  kind: "expense",
  archived: true,
};

const HOLIDAY: BudgetTag = { id: "t1", name: "Holiday", color: null, txCount: 3 };

const TAG_BODY: TagBody = { name: "Holiday", color: null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

describe("useBudgetCategories", () => {
  it("GETs the category list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([GROCERIES])));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].defaultKey).toBe("groceries");
    expect(fetch).toHaveBeenCalledWith("/api/budget/categories", { headers: {}, signal: expect.any(AbortSignal) });
  });
});

describe("useUpdateBudgetCategory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...GROCERIES, archived: true })));
  });

  it("PATCHes the full body and invalidates categories and transactions", async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetCategories(), [GROCERIES]);
    client.setQueryData(keys.transactions(), { pages: [] });
    const { result } = renderHook(() => useUpdateBudgetCategory(), { wrapper });

    result.current.mutate({ id: "c1", body: BODY });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      "/api/budget/categories/c1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(BODY) }),
    );
    expect(client.getQueryState(keys.budgetCategories())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.transactions())?.isInvalidated).toBe(true);
  });
});

describe("useCreateBudgetCategory", () => {
  it("surfaces a duplicate name as a 409 ApiError and invalidates nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("dup", { status: 409 })));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetCategories(), [GROCERIES]);
    const { result } = renderHook(() => useCreateBudgetCategory(), { wrapper });

    result.current.mutate(BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(client.getQueryState(keys.budgetCategories())?.isInvalidated).toBe(false);
    expect(client.getQueryData(keys.budgetCategories())).toEqual([GROCERIES]);
  });
});

describe("useReorderBudgetCategories", () => {
  it("refreshes the category list only — nothing else reads the order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetCategories(), [GROCERIES]);
    client.setQueryData(keys.transactions(), { pages: [] });
    client.setQueryData(keys.budgetSummary(), {});
    const { result } = renderHook(() => useReorderBudgetCategories(), { wrapper });

    result.current.mutate(["c1"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(keys.budgetCategories())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.transactions())?.isInvalidated).toBe(false);
    expect(client.getQueryState(keys.budgetSummary())?.isInvalidated).toBe(false);
  });
});

describe("useDeleteBudgetCategory", () => {
  it("DELETEs by id and tolerates the 204 empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetCategories(), [GROCERIES]);
    const { result } = renderHook(() => useDeleteBudgetCategory(), { wrapper });

    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      "/api/budget/categories/c1",
      expect.objectContaining({ method: "DELETE" }),
    );
    // No optimistic removal: the list is refetched, never hand-edited.
    expect(client.getQueryData(keys.budgetCategories())).toEqual([GROCERIES]);
    expect(client.getQueryState(keys.budgetCategories())?.isInvalidated).toBe(true);
  });
});

describe("useBudgetTags", () => {
  it("GETs the tag list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([HOLIDAY])));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBudgetTags(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe("Holiday");
    expect(fetch).toHaveBeenCalledWith("/api/budget/tags", { headers: {}, signal: expect.any(AbortSignal) });
  });
});

describe("useCreateBudgetTag", () => {
  it("POSTs the body and refreshes only the tag list — a new tag is on no row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(HOLIDAY, 201)));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetTags(), []);
    client.setQueryData(keys.transactions(), { pages: [] });
    const { result } = renderHook(() => useCreateBudgetTag(), { wrapper });

    result.current.mutate(TAG_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      "/api/budget/tags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Holiday", color: null }),
      }),
    );
    expect(client.getQueryState(keys.budgetTags())?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.transactions())?.isInvalidated).toBe(false);
  });
});

describe("useUpdateBudgetTag", () => {
  it("PATCHes the full body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...HOLIDAY, color: "#fff" })));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetTags(), [HOLIDAY]);
    const { result } = renderHook(() => useUpdateBudgetTag(), { wrapper });

    result.current.mutate({ id: "t1", body: { name: "Holiday", color: "#fff" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      "/api/budget/tags/t1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Holiday", color: "#fff" }),
      }),
    );
    expect(client.getQueryState(keys.budgetTags())?.isInvalidated).toBe(true);
  });
});

describe("useDeleteBudgetTag", () => {
  it("DELETEs by id and tolerates the 204 empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { client, wrapper } = makeWrapper();
    client.setQueryData(keys.budgetTags(), [HOLIDAY]);
    const { result } = renderHook(() => useDeleteBudgetTag(), { wrapper });

    result.current.mutate("t1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      "/api/budget/tags/t1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(client.getQueryData(keys.budgetTags())).toEqual([HOLIDAY]);
    expect(client.getQueryState(keys.budgetTags())?.isInvalidated).toBe(true);
  });
});
