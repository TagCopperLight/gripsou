import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive, ArchiveRestore, ChevronDown, ChevronUp, Lock, Pencil, Plus, Trash2,
} from "lucide-react";

import { Surface } from "../Surface";
import { Button } from "../Button";
import { CardState } from "../CardState";
import {
  useBudgetCategories,
  useReorderBudgetCategories,
  useUpdateBudgetCategory,
  type BudgetCategory,
  type CategoryBody,
} from "../../api/budget";
import {
  BUDGET_KINDS, categoryLabel, safeBudgetColor, sortCategories,
} from "../../lib/budget";
import { withAlpha } from "../../lib/color";
import { CategoryModal } from "./CategoryModal";
import { DeleteCategoryModal } from "./DeleteCategoryModal";
import { CategoryIcon } from "./CategoryIcon";

const KIND_BADGE: Record<BudgetCategory["kind"], string> = {
  expense: "text-red-light bg-red-light/14",
  income: "text-green-light bg-green-light/14",
  neutral: "text-fg-faint bg-surface-2",
};

/** Rows have no rules; the hover rectangle is the separator. `border-separate`
 *  on the table is what lets the first/last cell round the row's ends. */
const CELL =
  "py-2 bg-transparent transition-colors duration-140 group-hover:bg-surface-2";

/** Breathing room on either side of the kind badge, so it reads as its own
 *  column rather than a suffix of the name. The name side is deliberately wide:
 *  the badge should land well clear of even a long category. */
const GAP_NAME = "pr-40";
const GAP_KIND = "pr-12";

/** The SYSTEM / ARCHIVED chips that qualify a name. */
const BADGE =
  "rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-fg-faint";

/** Only on the hovered row — faded out rather than removed, so the column
 *  keeps its width and nothing shifts under the pointer. `focus-within` keeps
 *  them reachable by keyboard, where there is no hover to speak of. */
const ARROWS =
  "flex flex-col items-center -space-y-1 opacity-0 transition-opacity duration-140 group-hover:opacity-100 focus-within:opacity-100";

/** Small, and dead-looking at the ends of a kind rather than hidden, so the
 *  column keeps its width and the rows stay aligned. */
const ARROW_BTN =
  "p-0.5 rounded text-fg-faint hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:text-fg-faint";

const ACTION_BTN =
  "p-1.5 rounded-lg text-fg hover:bg-surface-3 transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

const DELETE_BTN =
  "p-1.5 rounded-lg text-red hover:bg-surface-3 transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

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

/** Sized like `ACTION_BTN` so a locked slot keeps the column aligned. */
function SystemLock({ testId, title }: { testId: string; title: string }) {
  return (
    <span
      data-testid={testId}
      title={title}
      className="p-1.5 inline-flex items-center justify-center text-fg-faint"
    >
      <Lock className="size-4" />
    </span>
  );
}

export function CategoriesSurface() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useBudgetCategories();
  const update = useUpdateBudgetCategory();
  const reorder = useReorderBudgetCategories();

  const [showArchived, setShowArchived] = useState(false);
  // Keyed by category id so archiving row A can't clear row B's busy state
  // when A's write settles first — each row waits only on its own write.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState(false);

  const [editing, setEditing] = useState<BudgetCategory | "new" | null>(null);
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

  /** The neighbour a row would trade places with — the previous/next row of
   *  the same kind that is actually on screen. `undefined` means the row is at
   *  that end of its kind and the arrow is dead. */
  function neighbour(c: BudgetCategory, dir: -1 | 1): BudgetCategory | undefined {
    const siblings = visibleRows.filter((r) => r.kind === c.kind);
    return siblings[siblings.indexOf(c) + dir];
  }

  /** Moves `c` past its visible neighbour and persists the whole list. Hidden
   *  archived rows are carried along rather than stepped on: the row lands
   *  where the neighbour was in the *full* kind list, so the arrow always
   *  moves the row exactly one visible place. */
  function runMove(c: BudgetCategory, dir: -1 | 1) {
    const target = neighbour(c, dir);
    if (!target || reorder.isPending) return;
    setActionError(false);

    const kindRows = rows.filter((r) => r.kind === c.kind);
    const to = kindRows.indexOf(target);
    const moved = kindRows.filter((r) => r.id !== c.id);
    // `to` still addresses the right slot after the removal: moving up, the
    // rows before it did not shift; moving down, the neighbour slid one place
    // left, so inserting at `to` puts `c` just after it.
    moved.splice(to, 0, c);

    const order = BUDGET_KINDS.flatMap((k) =>
      k === c.kind ? moved : rows.filter((r) => r.kind === k),
    );
    reorder.mutate(
      order.map((r) => r.id),
      { onError: () => setActionError(true) },
    );
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
              {!isLoading && !isError && (
                <span className="text-fg-faint font-normal ml-2">
                  <span className="mr-2">·</span>
                  {t("settings.budget.categories.categoriesCount", { count: rows.length })}
                </span>
              )}
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
                <table className="w-full text-sm border-separate border-spacing-y-0.5">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-fg-faint">
                      <th className="pb-2 pl-1.5 pr-3" />
                      <th className={`pb-2 ${GAP_NAME} whitespace-nowrap`}>
                        {t("settings.budget.categories.colCategory")}
                      </th>
                      <th className={`pb-2 ${GAP_KIND} whitespace-nowrap`}>
                        {t("settings.budget.categories.colKind")}
                      </th>
                      <th className="pb-2 pr-3 w-full">
                        {t("settings.budget.categories.colHint")}
                      </th>
                      <th className="pb-2 pr-3 text-right whitespace-nowrap">
                        {t("settings.budget.categories.colRows")}
                      </th>
                      <th className="pb-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((c) => {
                      const isSystem = c.systemKey !== null;
                      const label = categoryLabel(t, c);
                      const color = safeBudgetColor(c.color);
                      const busy = pendingIds.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={`group ${c.archived ? "opacity-55" : ""}`}
                        >
                          <td className={`${CELL} rounded-l-xl pl-1.5 pr-3 align-middle`}>
                            <div className={ARROWS}>
                              <button
                                type="button"
                                disabled={!neighbour(c, -1) || reorder.isPending}
                                onClick={() => runMove(c, -1)}
                                aria-label={t("settings.budget.categories.moveUp", { name: label })}
                                className={ARROW_BTN}
                              >
                                <ChevronUp className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={!neighbour(c, 1) || reorder.isPending}
                                onClick={() => runMove(c, 1)}
                                aria-label={t("settings.budget.categories.moveDown", { name: label })}
                                className={ARROW_BTN}
                              >
                                <ChevronDown className="size-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className={`${CELL} ${GAP_NAME} whitespace-nowrap`}>
                            <div className="flex items-center gap-2">
                              <span
                                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                                style={{ backgroundColor: withAlpha(color, 0.22) }}
                              >
                                <CategoryIcon icon={c.icon} className="size-4" style={{ color }} />
                              </span>
                              <span data-testid="category-name" className="text-fg font-medium">
                                {label}
                              </span>
                              {isSystem && (
                                <span className={BADGE}>
                                  {t("settings.budget.categories.system")}
                                </span>
                              )}
                              {c.archived && (
                                <span className={BADGE}>
                                  {t("settings.budget.categories.archivedBadge")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`${CELL} ${GAP_KIND}`}>
                            <span
                              className={`inline-block rounded-md px-1.75 py-0.5 text-[11px] font-medium ${KIND_BADGE[c.kind]}`}
                            >
                              {t(`budget.kinds.${c.kind}`)}
                            </span>
                          </td>
                          <td className={`${CELL} pr-3 w-full max-w-0 text-fg-dim text-[12.5px]`}>
                            {/* `max-w-0` with the column's `w-full` is what gives
                                `truncate` a width to work against inside a table. */}
                            <div className="truncate" title={c.hint ?? undefined}>
                              {c.hint ?? t("settings.budget.categories.noHint")}
                            </div>
                          </td>
                          <td className={`${CELL} pr-3 text-right text-fg-faint tabular-nums`}>
                            {c.txCount}
                          </td>
                          <td className={`${CELL} pr-3 rounded-r-xl`}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditing(c)}
                                aria-label={t("settings.budget.categories.edit", { name: label })}
                                className={ACTION_BTN}
                              >
                                <Pencil className="size-4" />
                              </button>
                              {isSystem ? (
                                <>
                                  {/* One lock per refused action, in the slot that
                                      action would occupy: the system row can still
                                      be renamed and restyled, only archived and
                                      deleted are out. */}
                                  <SystemLock
                                    testId="system-lock-archive"
                                    title={t("settings.budget.categories.archiveLocked")}
                                  />
                                  <SystemLock
                                    testId="system-lock-delete"
                                    title={t("settings.budget.categories.deleteLocked")}
                                  />
                                </>
                              ) : (
                                <>
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
                                    className={ACTION_BTN}
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
                                    className={DELETE_BTN}
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </>
                              )}
                            </div>
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
                <div className="mt-3 flex justify-start pl-3">
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
