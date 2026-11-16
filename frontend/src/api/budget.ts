import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "./client";
import { keys } from "./keys";
import { watchQuery } from "./watch";
import { transactionFilterFields, type TransactionFilterQuery } from "./filter";
import {
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
  afterTransactionChange,
} from "./invalidate";
import type {
  ApplyToDescriptionBody,
  AiStatus,
  BudgetAiPriceReq,
  BudgetCategory,
  BudgetTag,
  BulkBody,
  CategoryBody,
  SetBudgetAiSettingsReq,
  TagBody,
  Transaction,
  TransactionPatch,
  UndoReviewReq,
} from "./wire";

/** The server has no partial update: every write re-sends the whole row. */
export function categoryBody(c: CategoryBody, patch: Partial<CategoryBody> = {}): CategoryBody {
  return { name: c.name, color: c.color, icon: c.icon, hint: c.hint, kind: c.kind, archived: c.archived, ...patch };
}

export function useBudgetCategories() {
  return useQuery({
    queryKey: keys.budgetCategories(),
    queryFn: ({ signal }) => api("GET /budget/categories", { signal }),
  });
}

export function useCreateBudgetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CategoryBody) => api("POST /budget/categories", { body }),
    onSuccess: () => afterBudgetCategoryCreated(qc),
  });
}

export function useUpdateBudgetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryBody }) =>
      api("PATCH /budget/categories/:id", { params: { id }, body }),
    onSuccess: () => afterBudgetCategoryChange(qc),
  });
}

/** The cache moves at once and rolls back if the write fails. */
export function useReorderBudgetCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api("PUT /budget/categories/order", { body: { ids } }),
    onMutate: async (ids: string[]) => {
      // An in-flight refetch would land on the optimistic order and bounce the row back.
      await qc.cancelQueries({ queryKey: keys.budgetCategories() });
      const previous = qc.getQueryData<BudgetCategory[]>(keys.budgetCategories());
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const next = ids.map((id) => byId.get(id)).filter((c): c is BudgetCategory => !!c);
        // A list that lost a row means the cache moved under us: leave it to the refetch.
        if (next.length === previous.length) qc.setQueryData(keys.budgetCategories(), next);
      }
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.budgetCategories(), ctx.previous);
    },
    onSettled: () => afterBudgetCategoryReorder(qc),
  });
}

export function useDeleteBudgetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /budget/categories/:id", { params: { id } }),
    onSuccess: () => afterBudgetCategoryChange(qc),
  });
}

export function useBudgetTags() {
  return useQuery({
    queryKey: keys.budgetTags(),
    queryFn: ({ signal }) => api("GET /budget/tags", { signal }),
  });
}

export function useCreateBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagBody) => api("POST /budget/tags", { body }),
    onSuccess: () => afterBudgetTagCreated(qc),
  });
}

export function useUpdateBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TagBody }) =>
      api("PATCH /budget/tags/:id", { params: { id }, body }),
    onSuccess: () => afterBudgetTagChange(qc),
  });
}

export function useDeleteBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /budget/tags/:id", { params: { id } }),
    onSuccess: () => afterBudgetTagChange(qc),
  });
}

export type BulkInput = Omit<BulkBody, "filter"> & { filter?: TransactionFilterQuery };

function withConfirm<B extends { confirmBreakPairs?: boolean }>({ confirmBreakPairs, ...rest }: B) {
  return confirmBreakPairs ? { ...rest, confirmBreakPairs: true } : rest;
}

function onlyChecked(body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked"> & { tagIds?: string[] | null }) {
  return body.checked != null && body.categoryId === undefined && body.tagIds == null && body.addTagIds == null;
}

/** Unknown tags sort after every known one. */
function catalogRank(catalog: { id: string }[], id: string): number {
  const i = catalog.findIndex((tag) => tag.id === id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** The row as the server holds it after `body`. The other half of a broken pair is unknown here and arrives with the refetch. */
function rowAfter(row: Transaction, body: TransactionPatch, qc: QueryClient): Transaction {
  const next = { ...row };
  if (body.categoryId !== undefined) {
    const categories = qc.getQueryData<BudgetCategory[]>(keys.budgetCategories());
    const c = categories?.find((x) => x.id === body.categoryId) ?? null;
    Object.assign(next, {
      categoryId: c?.id ?? null,
      categoryName: c?.name ?? null,
      categoryDefaultKey: c?.defaultKey ?? null,
      categoryColor: c?.color ?? null,
      categoryIcon: c?.icon ?? null,
      categoryKind: c?.kind ?? null,
      categorySource: c ? "user" : null,
      categoryConfidence: null,
      needsReview: false,
      isTransfer: row.isTransfer && !body.confirmBreakPairs,
    });
  }
  if (body.tagIds) {
    const catalog = qc.getQueryData<BudgetTag[]>(keys.budgetTags()) ?? [];
    // The catalog's order, as the server sends tags back, so a new tag doesn't jump when the response lands.
    next.tags = body.tagIds
      .map(
        (id) =>
          catalog.find((tag) => tag.id === id) ??
          row.tags.find((tag) => tag.id === id) ?? { id, name: "", color: null },
      )
      .sort((a, b) => catalogRank(catalog, a.id) - catalogRank(catalog, b.id));
  }
  if (body.checked != null) next.checked = body.checked;
  return next;
}

export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionPatch; optimistic?: boolean }) =>
      api("PATCH /transactions/:id", { params: { id }, body: withConfirm(body) }),
    onMutate: async ({ id, body, optimistic }) => {
      if (!optimistic) return { previous: [] as [readonly unknown[], unknown][] };
      // Every cached filter combination may hold this row.
      await qc.cancelQueries({ queryKey: keys.transactions() });
      const previous = qc.getQueriesData({ queryKey: keys.transactions() });
      qc.setQueriesData<InfiniteData<Transaction[]>>({ queryKey: keys.transactions() }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) =>
                page.map((row) => (row.id === id ? rowAfter(row, body, qc) : row)),
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (res, _vars, ctx) => {
      if (!res?.pendingPairBreaks) return;
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_res, _err, { body }) =>
      onlyChecked(body) ? afterCheckedChange(qc) : afterTransactionChange(qc),
  });
}

export function useApplyToDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ApplyToDescriptionBody & { id: string }) =>
      api("POST /transactions/:id/apply-to-description", { params: { id }, body: withConfirm(body) }),
    onSuccess: () => afterTransactionChange(qc),
  });
}

/** "Select all shown" with no filter is 3.5 years of rows, too many to enumerate, so it sends the filter, encoded as the list does. */
export function useBulkTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkInput) => {
      const wire: BulkBody = {
        ...withConfirm(body),
        filter: body.filter ? transactionFilterFields(body.filter) : undefined,
      };
      return api("POST /transactions/bulk", { body: wire });
    },
    onSuccess: (_res, body) =>
      onlyChecked(body) ? afterCheckedChange(qc) : afterTransactionChange(qc),
  });
}

export type BudgetAiPrices = Record<string, BudgetAiPriceReq>;

/** A durable timestamp lets a short run missed between polls still refresh its queries. */
function onAiStatusChange(qc: QueryClient) {
  return (prev: AiStatus, next: AiStatus) => {
    const completed = next.lastRun !== null && next.lastRun.startedAt !== prev.lastRun?.startedAt;
    if ((prev.running && !next.running) || completed) void afterAiRunFinished(qc);
    else if (next.running && (next.remaining !== prev.remaining || next.reviewCount !== prev.reviewCount))
      afterAiRunProgress(qc);
  };
}

/** Fast polls while running; idle checks find automatic or short runs. */
export function useAiStatus() {
  const qc = useQueryClient();
  useEffect(() => watchQuery(qc, keys.budgetAiStatus(), onAiStatusChange(qc)), [qc]);
  return useQuery({
    queryKey: keys.budgetAiStatus(),
    queryFn: ({ signal }) => api("GET /budget/categorize/status", { signal }),
    refetchInterval: (q) => (q.state.data?.running ? 5000 : q.state.data?.configured ? 30_000 : false),
  });
}

export function useRequestCategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("POST /budget/categorize"),
    onSettled: () => afterCategorizeRequested(qc),
  });
}

export function useAcceptReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api("POST /budget/review/:id/accept", { params: { id } }),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useUndoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UndoReviewReq & { id: string }) =>
      api("POST /budget/review/:id/undo", { params: { id }, body }),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useBudgetAiSettings() {
  return useQuery({
    queryKey: keys.budgetAiSettings(),
    queryFn: ({ signal }) => api("GET /settings/budget-ai", { signal }),
  });
}

export function useSetBudgetAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetBudgetAiSettingsReq) =>
      api("PATCH /settings/budget-ai", { body }),
    onSettled: () => afterBudgetAiSettingsChange(qc),
  });
}

/** Not retried: a failure falls back to typing the name. */
export function useBudgetAiModels(provider: string | null) {
  return useQuery({
    queryKey: keys.budgetAiModels(provider ?? ""),
    queryFn: ({ signal }) => api("GET /settings/budget-ai/models/:provider", { params: { provider: provider ?? "" }, signal }),
    enabled: provider !== null,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

export function useBudgetAiUsage() {
  return useQuery({
    queryKey: keys.budgetAiUsage(),
    queryFn: ({ signal }) => api("GET /settings/budget-ai/usage", { signal }),
  });
}

export function useSetBudgetAiPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prices: BudgetAiPrices) => api("PUT /settings/budget-ai/prices", { body: prices }),
    onSettled: () => afterBudgetAiPricesChange(qc),
  });
}
