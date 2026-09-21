import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { Surface } from "../Surface";
import { Button } from "../Button";
import { CardState } from "../CardState";
import {
  useBudgetCategories,
  useUpdateBudgetCategory,
  type BudgetCategory,
  type CategoryBody,
} from "../../api/budget";
import { budgetIcon, categoryLabel, safeBudgetColor, sortCategories } from "../../lib/budget";
import { withAlpha } from "../../lib/color";
import { CategoryModal } from "./CategoryModal";
import { DeleteCategoryModal } from "./DeleteCategoryModal";

const KIND_BADGE: Record<BudgetCategory["kind"], string> = {
  expense: "text-red bg-red/18",
  income: "text-green bg-green/18",
  internal: "text-blue bg-blue/18",
  excluded: "text-fg-faint bg-surface-2",
};

function archiveBody(c: BudgetCategory): CategoryBody {
  return {
    name: c.name,
    color: c.color,
    icon: c.icon,
    hint: c.hint,
    kind: c.kind,
    archived: !c.archived,
  };
}

export function CategoriesSurface() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useBudgetCategories();
  const update = useUpdateBudgetCategory();

  const [showArchived, setShowArchived] = useState(false);
  // Keyed by category id so archiving row A can't clear row B's busy state
  // when A's write settles first — each row waits only on its own write.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState(false);

  // Task 5
  const [editing, setEditing] = useState<BudgetCategory | "new" | null>(null);
  // Task 5
  const [deleting, setDeleting] = useState<BudgetCategory | null>(null);

  const rows = sortCategories(data ?? []);
  const archivedCount = rows.filter((c) => c.archived).length;
  const visibleRows = rows.filter((c) => !c.archived || showArchived);

  function toggleShowArchived() {
    setActionError(false);
    setShowArchived((v) => !v);
  }

  function openEditing(c: BudgetCategory | "new") {
    setActionError(false);
    setEditing(c);
  }

  function closeEditing() {
    setActionError(false);
    setEditing(null);
  }

  function openDeleting(c: BudgetCategory) {
    setActionError(false);
    setDeleting(c);
  }

  function closeDeleting() {
    setActionError(false);
    setDeleting(null);
  }

  function runArchiveToggle(c: BudgetCategory) {
    setActionError(false);
    setPendingIds((prev) => new Set(prev).add(c.id));
    // `mutateAsync` (not `mutate` + per-call options) because `useMutation`
    // keeps a single shared `mutateOptions` slot: archiving row A then row B
    // before A settles overwrites A's onSettled with B's, so A's write would
    // clear *B*'s pending flag. The returned promise is per-call and immune
    // to that, which is what lets each row wait only on its own write.
    update.mutateAsync({ id: c.id, body: archiveBody(c) }).then(
      () => {},
      () => setActionError(true),
    ).finally(() =>
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      }),
    );
  }

  return (
    <div>
      <Surface className="w-full">
        <div className="flex flex-col p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-fg font-semibold text-sm">
              {t("settings.budget.categories.title")}
            </h2>
            <Button
              onClick={() => openEditing("new")}
              padded={false}
              className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs px-2.75 py-1.5 md:w-auto"
            >
              <Plus className="size-4" />
              {t("settings.budget.categories.add")}
            </Button>
          </div>

          {isLoading ? (
            <CardState variant="loading" className="mt-4 h-64" />
          ) : isError ? (
            <CardState variant="error" onRetry={() => refetch()} className="mt-4 h-64" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-fg-faint py-10 text-center">
              {t("settings.budget.categories.empty")}
            </p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-fg-faint">
                      <th className="pb-2 pr-2">{t("settings.budget.categories.colCategory")}</th>
                      <th className="pb-2 pr-2">{t("settings.budget.categories.colKind")}</th>
                      <th className="pb-2 pr-2">{t("settings.budget.categories.colHint")}</th>
                      <th className="pb-2 pr-2">{t("settings.budget.categories.colRows")}</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((c) => {
                      const isSystem = c.systemKey !== null;
                      const label = categoryLabel(t, c);
                      const color = safeBudgetColor(c.color);
                      const Icon = budgetIcon(c.icon);
                      const busy = pendingIds.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={`border-t border-border/60 ${c.archived ? "opacity-55" : ""}`}
                        >
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                                style={{ backgroundColor: withAlpha(color, 0.22) }}
                              >
                                {Icon && <Icon className="size-4" style={{ color }} />}
                              </span>
                              {isSystem ? (
                                <button
                                  type="button"
                                  onClick={() => openEditing(c)}
                                  aria-label={t("settings.budget.categories.edit", { name: label })}
                                  className="text-fg font-medium hover:underline cursor-pointer"
                                >
                                  <span data-testid="category-name">{label}</span>
                                </button>
                              ) : (
                                <span data-testid="category-name" className="text-fg font-medium">
                                  {label}
                                </span>
                              )}
                              {isSystem && (
                                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg-faint">
                                  {t("settings.budget.categories.system")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 pr-2">
                            <span
                              className={`inline-block rounded-md px-1.75 py-0.5 text-[11px] font-medium ${KIND_BADGE[c.kind]}`}
                            >
                              {t(`budget.kinds.${c.kind}`)}
                            </span>
                          </td>
                          <td className="py-2 pr-2 text-fg-faint">
                            {c.hint ?? t("settings.budget.categories.noHint")}
                          </td>
                          <td className="py-2 pr-2 text-fg-faint">{c.txCount}</td>
                          <td className="py-2">
                            {isSystem ? (
                              <span
                                data-testid="system-lock"
                                title={t("settings.budget.categories.systemLocked")}
                                className="inline-flex items-center justify-center"
                              >
                                <Lock className="size-4 text-fg-faint" />
                              </span>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEditing(c)}
                                  aria-label={t("settings.budget.categories.edit", { name: label })}
                                  className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Pencil className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => runArchiveToggle(c)}
                                  aria-label={t(
                                    c.archived
                                      ? "settings.budget.categories.restore"
                                      : "settings.budget.categories.archive",
                                    { name: label },
                                  )}
                                  className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {c.archived ? (
                                    <ArchiveRestore className="size-4" />
                                  ) : (
                                    <Archive className="size-4" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openDeleting(c)}
                                  aria-label={t("settings.budget.categories.delete", { name: label })}
                                  className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {actionError && (
                <p role="alert" className="mt-3 text-xs text-red">
                  {t("settings.budget.categories.actionError")}
                </p>
              )}

              {archivedCount > 0 && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={toggleShowArchived}
                    className="text-xs font-medium text-fg-faint hover:text-fg transition-colors duration-140 cursor-pointer"
                  >
                    {t(
                      showArchived
                        ? "settings.budget.categories.hideArchived"
                        : "settings.budget.categories.showArchived",
                      { count: archivedCount },
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Surface>

      {editing && (
        <CategoryModal
          category={editing === "new" ? undefined : editing}
          onClose={closeEditing}
        />
      )}
      {deleting && <DeleteCategoryModal category={deleting} onClose={closeDeleting} />}
    </div>
  );
}
