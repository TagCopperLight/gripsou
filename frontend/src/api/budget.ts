import { useEffect } from "react";
import {
  hashKey,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { deleteJson, getJson, patchJson, postJson, putJson } from "./client";
import { keys } from "./keys";
import { transactionFilterFields } from "./filter";
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
import type { Transaction, TransactionFilterQuery } from "./types";

export type BudgetKind = "expense" | "income" | "internal" | "excluded";

/** One row of the user's own taxonomy. `defaultKey` survives only until the
 *  user renames the row, which is what makes a seeded name translatable and a
 *  renamed one verbatim. `systemKey` marks the undeletable pairing target. */
export type BudgetCategory = {
  id: string;
  name: string;
  defaultKey: string | null;
  color: string;
  icon: string | null;
  hint: string | null;
  kind: BudgetKind;
  systemKey: string | null;
  archived: boolean;
  txCount: number;
};

export type BudgetTag = { id: string; name: string; color: string | null; txCount: number };

/** The backend has no partial update: every write re-sends the whole row. */
export type CategoryBody = Pick<
  BudgetCategory,
  "name" | "color" | "icon" | "hint" | "kind" | "archived"
>;
export type TagBody = Pick<BudgetTag, "name" | "color">;

export function useBudgetCategories() {
  return useQuery({
    queryKey: keys.budgetCategories(),
    queryFn: () => getJson<BudgetCategory[]>("/budget/categories"),
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
    queryFn: () => getJson<BudgetTag[]>("/budget/tags"),
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

type TransactionPatch = {
  /** `null` clears the category. Omit the key to leave it untouched. */
  categoryId?: string | null;
  /** FULL REPLACE of the row's tag set — the server has no add/remove split,
   *  so a caller toggling one tag sends the complete resulting list. */
  tagIds?: string[];
  checked?: boolean;
  /** See `BulkBody.confirmBreakPairs`: recategorising a paired transfer is
   *  refused until the caller confirms dissolving the pair. */
  confirmBreakPairs?: boolean;
};

/** `pendingPairBreaks` set means refused, nothing written: see `WriteResult`. */
type PatchResult = { sameDescriptionCount: number; pendingPairBreaks?: number | null };

export type BulkBody = {
  /** Explicit rows. Omit and pass `filter` for "select all shown". */
  ids?: string[];
  filter?: TransactionFilterQuery;
  categoryId?: string | null;
  addTagIds?: string[];
  checked?: boolean;
  /** The caller has seen how many internal-transfer pairs this write would
   *  dissolve and wants it applied anyway. Without it, the server refuses such
   *  a write and reports the count instead of applying it. */
  confirmBreakPairs?: boolean;
};

/** A write that only ticks or unticks ✓ touches nothing but the rows. */
function onlyChecked(body: object): boolean {
  const fields = Object.entries(body)
    .filter(([k, v]) => v !== undefined && k !== "ids" && k !== "filter")
    .map(([k]) => k);
  return fields.length === 1 && fields[0] === "checked";
}

/** One row, applied to the cache before the request so the chip swaps at once.
 *  `optimistic` is the caller's view of the row after the write — the chip
 *  fields cannot be derived from the patch body, which carries only ids. */
export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionPatch; optimistic?: Partial<Transaction> }) =>
      patchJson<PatchResult>(`/transactions/${id}`, body),
    onMutate: async ({ id, optimistic }) => {
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
                page.map((row) => (row.id === id ? { ...row, ...optimistic } : row)),
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    // Refused pending confirmation: nothing was written, so the row goes back
    // to what it was while the caller asks.
    onSuccess: (res, _vars, ctx) => {
      if (!res?.pendingPairBreaks) return;
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_res, _err, { body }) =>
      onlyChecked(body) ? afterCheckedChange(qc) : afterTransactionChange(qc),
  });
}

/** A write the server refused pending confirmation reports `pendingPairBreaks`
 *  — how many internal-transfer pairs it would dissolve — and wrote nothing.
 *  Kept distinct from `updated: 0`: "wrote no rows" and "awaiting your
 *  confirmation" are different answers, and conflating them would silently
 *  swallow the confirmation step. */
/** `ids` comes back from apply-to-description only: the rows it wrote. */
type WriteResult = { updated: number; pendingPairBreaks?: number; ids?: string[] };

export function useApplyToDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      categoryId,
      confirmBreakPairs,
    }: {
      id: string;
      categoryId: string | null;
      confirmBreakPairs?: boolean;
    }) =>
      postJson<WriteResult>(`/transactions/${id}/apply-to-description`, {
        categoryId,
        ...(confirmBreakPairs ? { confirmBreakPairs: true } : {}),
      }),
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
    mutationFn: (body: BulkBody) => {
      const wire: Omit<BulkBody, "filter"> & { filter?: Record<string, unknown> } = {
        ...body,
        filter: body.filter ? transactionFilterFields(body.filter) : undefined,
      };
      return postJson<WriteResult>("/transactions/bulk", wire);
    },
    onSuccess: (_res, body) =>
      onlyChecked(body) ? afterCheckedChange(qc) : afterTransactionChange(qc),
  });
}

export type AiRunOutcome = "ok" | "partial" | "error";

/** GET /budget/categorize/status. `configured`: the server has a provider with
 *  its key. The review threshold is the reader's own pref, not part of this. */
export type AiStatus = {
  configured: boolean;
  running: boolean;
  remaining: number;
  reviewCount: number;
  lastRun: { outcome: AiRunOutcome; error: string | null } | null;
};

export type BudgetAiProvider = "gemini" | "jev";

export type BudgetAiSettings = {
  provider: BudgetAiProvider | null;
  model: string | null;
  available: BudgetAiProvider[];
  defaults: Record<BudgetAiProvider, string>;
};

/** One model's spend: token counts are numbers, prices (per million tokens)
 *  and costs are decimal strings; `cost` is null until the model is priced. */
export type BudgetAiModelUsage = {
  model: string;
  runs: number;
  runsWithoutUsage: number;
  tokensIn: number;
  tokensOut: number;
  priceIn: string | null;
  priceOut: string | null;
  cost: string | null;
};

export type BudgetAiUsage = {
  currency: string;
  models: BudgetAiModelUsage[];
  /** Sum of the priced models only. */
  totalCost: string;
};

/** Full replacement map of every model's prices, per million tokens. */
export type BudgetAiPrices = Record<string, { in: string; out: string }>;

const AI_STATUS_HASH = hashKey(keys.budgetAiStatus());
const watchedClients = new WeakSet<QueryClient>();

/** Installed once per client, however many components read the status, so a
 *  change refreshes once. Only a change seen while a run was in progress
 *  counts: when nothing was running, the status moved because of the user's
 *  own write (or a sync), which already refreshed what it touched. */
function watchAiRun(qc: QueryClient) {
  if (watchedClients.has(qc)) return;
  watchedClients.add(qc);
  let last = qc.getQueryData<AiStatus>(keys.budgetAiStatus());
  qc.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryHash !== AI_STATUS_HASH) return;
    const next = event.query.state.data as AiStatus | undefined;
    const prev = last;
    last = next;
    if (!prev?.running || !next) return;
    if (!next.running) afterAiRunFinished(qc);
    else if (next.remaining !== prev.remaining || next.reviewCount !== prev.reviewCount)
      afterAiRunProgress(qc);
  });
}

/** Polled every 5 s only while a run is in progress. As the run moves on the
 *  Overview figures fill in; the transactions list catches up when it ends. */
export function useAiStatus() {
  const qc = useQueryClient();
  useEffect(() => watchAiRun(qc), [qc]);
  return useQuery({
    queryKey: keys.budgetAiStatus(),
    queryFn: () => getJson<AiStatus>("/budget/categorize/status"),
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
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
      postJson<{ sameDescriptionCount: number }>(`/budget/review/${id}/accept`, {}),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useUndoReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      categoryId,
      confidence,
    }: {
      id: string;
      categoryId: string | null;
      confidence: string | null;
    }) => postJson<void>(`/budget/review/${id}/undo`, { categoryId, confidence }),
    onSettled: () => afterReviewChange(qc),
  });
}

export function useBudgetAiSettings() {
  return useQuery({
    queryKey: keys.budgetAiSettings(),
    queryFn: () => getJson<BudgetAiSettings>("/settings/budget-ai"),
  });
}

export function useSetBudgetAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { provider: BudgetAiProvider | null; model: string | null }) =>
      patchJson<void>("/settings/budget-ai", body),
    onSettled: () => afterBudgetAiSettingsChange(qc),
  });
}

export function useBudgetAiUsage() {
  return useQuery({
    queryKey: keys.budgetAiUsage(),
    queryFn: () => getJson<BudgetAiUsage>("/settings/budget-ai/usage"),
  });
}

export function useSetBudgetAiPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prices: BudgetAiPrices) => putJson<void>("/settings/budget-ai/prices", prices),
    onSettled: () => afterBudgetAiPricesChange(qc),
  });
}
