import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { deleteJson, getJson, patchJson, postJson, putJson } from "./client";
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
  AcceptReviewResponse,
  ApplyToDescriptionBody,
  AiStatus,
  BudgetAiPriceReq,
  BudgetAiSettings,
  BudgetAiUsage,
  BudgetCategory,
  BudgetTag,
  BulkBody,
  CategoryBody,
  PatchResult,
  SetBudgetAiSettingsReq,
  TagBody,
  Transaction,
  TransactionPatch,
  UndoReviewReq,
  WriteResult,
} from "./wire";

/** The whole body that re-sends what `c` holds, with `patch` over it. */
/** The server has no partial update: every write re-sends the whole row. */
export function categoryBody(c: CategoryBody, patch: Partial<CategoryBody> = {}): CategoryBody {
  return { name: c.name, color: c.color, icon: c.icon, hint: c.hint, kind: c.kind, archived: c.archived, ...patch };
}

export function useBudgetCategories() {
  return useQuery({
    queryKey: keys.budgetCategories(),
    queryFn: ({ signal }) => getJson<BudgetCategory[]>("/budget/categories", { signal }),
  });
}

export function useCreateBudgetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CategoryBody) => postJson<BudgetCategory>("/budget/categories", body),
    onSuccess: () => afterBudgetCategoryCreated(qc),
  });
}

export function useUpdateBudgetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryBody }) =>
      patchJson<BudgetCategory>(`/budget/categories/${id}`, body),
    onSuccess: () => afterBudgetCategoryChange(qc),
  });
}

/** Persists the whole list in display order; the server numbers it. The cache
 *  is moved optimistically so an arrow click lands at once instead of after a
 *  round trip, and is rolled back if the write fails. */
export function useReorderBudgetCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => putJson<void>("/budget/categories/order", { ids }),
    onMutate: async (ids: string[]) => {
      // An in-flight list refetch would otherwise land on top of the optimistic
      // order and bounce the row back.
      await qc.cancelQueries({ queryKey: keys.budgetCategories() });
      const previous = qc.getQueryData<BudgetCategory[]>(keys.budgetCategories());
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const next = ids.map((id) => byId.get(id)).filter((c): c is BudgetCategory => !!c);
        // Only reorder what we can account for: a list that lost a row is a
        // sign the cache moved under us, so leave it to the refetch.
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
    mutationFn: (id: string) => deleteJson<void>(`/budget/categories/${id}`),
    onSuccess: () => afterBudgetCategoryChange(qc),
  });
}

export function useBudgetTags() {
  return useQuery({
    queryKey: keys.budgetTags(),
    queryFn: ({ signal }) => getJson<BudgetTag[]>("/budget/tags", { signal }),
  });
}

export function useCreateBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TagBody) => postJson<BudgetTag>("/budget/tags", body),
    onSuccess: () => afterBudgetTagCreated(qc),
  });
}

export function useUpdateBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TagBody }) =>
      patchJson<BudgetTag>(`/budget/tags/${id}`, body),
    onSuccess: () => afterBudgetTagChange(qc),
  });
}

export function useDeleteBudgetTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/budget/tags/${id}`),
    onSuccess: () => afterBudgetTagChange(qc),
  });
}

/** A bulk write as the list makes it: `filter` is the list's own filter,
 *  encoded on the way out. */
export type BulkInput = Omit<BulkBody, "filter"> & { filter?: TransactionFilterQuery };

/** The flag goes on the wire only when set. */
function withConfirm<B extends { confirmBreakPairs?: boolean }>({ confirmBreakPairs, ...rest }: B) {
  return confirmBreakPairs ? { ...rest, confirmBreakPairs: true } : rest;
}

/** A write that only ticks or unticks ✓ touches nothing but the rows. */
function onlyChecked(body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked"> & { tagIds?: string[] | null }) {
  return body.checked != null && body.categoryId === undefined && body.tagIds == null && body.addTagIds == null;
}

/** A tag's place in the catalog; unknown tags sort after every known one. */
function catalogRank(catalog: { id: string }[], id: string): number {
  const i = catalog.findIndex((tag) => tag.id === id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** The row as the server holds it once `body` is written, resolved from the
 *  category and tag catalogs in the cache. A user's category write makes the
 *  row `user`-sourced, which clears the confidence and the review flag; a
 *  confirmed one unlinks the pair. The *other* half of that pair is not known
 *  here: it arrives with the refetch. */
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
    // In the catalog's order, which is the order the server sends a row's
    // tags back in, so a new tag doesn't jump when the response lands.
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

/** One row. With `optimistic`, the cached row shows the write before the
 *  server answers, and goes back if the write fails or is refused. */
export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionPatch; optimistic?: boolean }) =>
      patchJson<PatchResult>(`/transactions/${id}`, withConfirm(body)),
    onMutate: async ({ id, body, optimistic }) => {
      if (!optimistic) return { previous: [] as [readonly unknown[], unknown][] };
      // Every cached filter combination may hold this row, so patch the whole
      // family rather than guessing which key the caller is reading.
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
      postJson<WriteResult>(`/transactions/${id}/apply-to-description`, withConfirm(body)),
    onSuccess: () => afterTransactionChange(qc),
  });
}

/** Ids for a hand-picked selection, `filter` for "select all shown" — which
 *  with no filter set is 3.5 years of rows, far too many to enumerate. The
 *  filter goes through the same encoder as the list and its counts, so the
 *  write and the view cannot disagree. */
export function useBulkTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkInput) => {
      const wire: BulkBody = {
        ...withConfirm(body),
        filter: body.filter ? transactionFilterFields(body.filter) : undefined,
      };
      return postJson<WriteResult>("/transactions/bulk", wire);
    },
    onSuccess: (_res, body) =>
      onlyChecked(body) ? afterCheckedChange(qc) : afterTransactionChange(qc),
  });
}

/** Full replacement map of every model's prices, per million tokens. */
export type BudgetAiPrices = Record<string, BudgetAiPriceReq>;

/** A finished run has a durable timestamp, so a short run missed between
 *  polls still refreshes its dependent queries. */
function onAiStatusChange(qc: QueryClient) {
  return (prev: AiStatus, next: AiStatus) => {
    const completed = next.lastRun !== null && next.lastRun.startedAt !== prev.lastRun?.startedAt;
    if ((prev.running && !next.running) || completed) void afterAiRunFinished(qc);
    else if (next.running && (next.remaining !== prev.remaining || next.reviewCount !== prev.reviewCount))
      afterAiRunProgress(qc);
  };
}

/** Fast polls while running; idle checks discover automatic or short runs.
 *  The Overview fills in live; transaction rows catch up at completion. */
export function useAiStatus() {
  const qc = useQueryClient();
  useEffect(() => watchQuery(qc, keys.budgetAiStatus(), onAiStatusChange(qc)), [qc]);
  return useQuery({
    queryKey: keys.budgetAiStatus(),
    queryFn: ({ signal }) => getJson<AiStatus>("/budget/categorize/status", { signal }),
    refetchInterval: (q) => (q.state.data?.running ? 5000 : q.state.data?.configured ? 30_000 : false),
  });
}

export function useRequestCategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<void>("/budget/categorize", {}),
    onSettled: () => afterCategorizeRequested(qc),
  });
}

export function useAcceptReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      postJson<AcceptReviewResponse>(`/budget/review/${id}/accept`, {}),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useUndoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UndoReviewReq & { id: string }) =>
      postJson<void>(`/budget/review/${id}/undo`, body),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useBudgetAiSettings() {
  return useQuery({
    queryKey: keys.budgetAiSettings(),
    queryFn: ({ signal }) => getJson<BudgetAiSettings>("/settings/budget-ai", { signal }),
  });
}

export function useSetBudgetAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetBudgetAiSettingsReq) =>
      patchJson<void>("/settings/budget-ai", body),
    onSettled: () => afterBudgetAiSettingsChange(qc),
  });
}

/** The models the provider offers, asked of the provider itself. Not
 *  retried: a failure falls back to typing the name. */
export function useBudgetAiModels(provider: string | null) {
  return useQuery({
    queryKey: keys.budgetAiModels(provider ?? ""),
    queryFn: ({ signal }) => getJson<string[]>(`/settings/budget-ai/models/${provider}`, { signal }),
    enabled: provider !== null,
    retry: false,
    staleTime: 60 * 60 * 1000,
  });
}

export function useBudgetAiUsage() {
  return useQuery({
    queryKey: keys.budgetAiUsage(),
    queryFn: ({ signal }) => getJson<BudgetAiUsage>("/settings/budget-ai/usage", { signal }),
  });
}

export function useSetBudgetAiPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prices: BudgetAiPrices) => putJson<void>("/settings/budget-ai/prices", prices),
    onSettled: () => afterBudgetAiPricesChange(qc),
  });
}
