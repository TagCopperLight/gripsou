import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";

import { deleteJson, getJson, patchJson, postJson, putJson } from "./client";
import { keys } from "./keys";
import { afterBudgetCategoryChange, afterBudgetTagChange, afterTransactionChange } from "./invalidate";
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
    onSuccess: () => afterBudgetCategoryChange(qc),
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
    onSettled: () => afterBudgetCategoryChange(qc),
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
    onSuccess: () => afterBudgetTagChange(qc),
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

export type TransactionPatch = {
  /** `null` clears the category. Omit the key to leave it untouched. */
  categoryId?: string | null;
  /** FULL REPLACE of the row's tag set — the server has no add/remove split,
   *  so a caller toggling one tag sends the complete resulting list. */
  tagIds?: string[];
  checked?: boolean;
};

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

/** One row, applied to the cache before the request so the chip swaps at once.
 *  `optimistic` is the caller's view of the row after the write — the chip
 *  fields cannot be derived from the patch body, which carries only ids. */
export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransactionPatch; optimistic?: Partial<Transaction> }) =>
      patchJson<{ sameDescriptionCount: number }>(`/transactions/${id}`, body),
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
    onSettled: () => afterTransactionChange(qc),
  });
}

/** A write the server refused pending confirmation reports `pendingPairBreaks`
 *  — how many internal-transfer pairs it would dissolve — and wrote nothing.
 *  Kept distinct from `updated: 0`: "wrote no rows" and "awaiting your
 *  confirmation" are different answers, and conflating them would silently
 *  swallow the confirmation step. */
type WriteResult = { updated: number; pendingPairBreaks?: number };

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

/** The filter as the JSON bulk endpoint parses it. Ids stay comma-joined
 *  strings (the server's `parse_ids` reads `Option<String>`), but booleans
 *  must be real JSON booleans: serde_json will not coerce "true". */
function transactionFilterBody(q: TransactionFilterQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (q.search) body.search = q.search;
  if (q.accountId) body.accountId = q.accountId;
  if (q.bucket && q.bucket !== "all") body.bucket = q.bucket;
  if (q.from) body.from = q.from;
  if (q.to) body.to = q.to;
  if (q.categoryIds?.length) body.categoryIds = q.categoryIds.join(",");
  if (q.tagIds?.length) body.tagIds = q.tagIds.join(",");
  if (q.uncategorized) body.uncategorized = true;
  if (q.needsReview) body.needsReview = true;
  return body;
}

/** Ids for a hand-picked selection, `filter` for "select all shown" — which
 *  with no filter set is 3.5 years of rows, far too many to enumerate. The
 *  filter goes over the wire in the same shape the list is reading, so the
 *  write and the view can never disagree. */
export function useBulkTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkBody) => {
      const wire: Omit<BulkBody, "filter"> & { filter?: Record<string, unknown> } = {
        ...body,
        filter: body.filter ? transactionFilterBody(body.filter) : undefined,
      };
      return postJson<WriteResult>("/transactions/bulk", wire);
    },
    onSuccess: () => afterTransactionChange(qc),
  });
}
