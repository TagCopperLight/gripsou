import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteJson, getJson, patchJson, postJson } from "./client";
import { keys } from "./keys";
import { afterBudgetCategoryChange, afterBudgetTagChange } from "./invalidate";

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
