import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";
import { ChevronDown, ChevronUp, Lock, Plus } from "lucide-react";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Button } from "../../../ui/Button";
import { CardError } from "../../../ui/CardError";
import { Skeleton } from "../../../ui/Skeleton";
import { boneWidths } from "../../../ui/boneWidths";
import { useBudgetCategories, useReorderBudgetCategories } from "../../../api/budget";
import type { BudgetCategory } from "../../../api/wire";
import {
  BUDGET_KINDS, categoryLabel, categoryNeighbour, categoryOrderAfterMove, safeBudgetColor, sortCategories,
} from "../../../lib/budget";
import { CategoryModal } from "./CategoryModal";
import { DeleteCategoryModal } from "./DeleteCategoryModal";
import { CategoryIcon } from "../CategoryIcon";
import { List, ListBadge, ListHeadingBone, ListRow, ListRowBone, ListTile } from "./SettingsList";

/** Only on the hovered row, faded rather than removed so nothing shifts under
 *  the pointer; `focus-within` keeps them reachable by keyboard. */
const ARROWS =
  "flex gap-0.5 opacity-0 transition-opacity duration-140 group-hover:opacity-100 focus-within:opacity-100";

/** Dead-looking at the ends of a kind rather than hidden, so both arrows keep
 *  their place. */
const ARROW_BTN =
  "flex size-7 items-center justify-center rounded-md text-fg-faint enabled:hover:bg-surface-3 enabled:hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-25";

export function CategoriesSurface() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useBudgetCategories();
  const reorder = useReorderBudgetCategories();

  const [showArchived, setShowArchived] = useState(false);
  const [moveError, setMoveError] = useState(false);
  const [editing, setEditing] = useState<BudgetCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<BudgetCategory | null>(null);

  const rows = sortCategories(data ?? []);
  const active = rows.filter((c) => !c.archived);
  const archived = rows.filter((c) => c.archived);

  function runMove(c: BudgetCategory, dir: -1 | 1) {
    if (reorder.isPending) return;
    const order = categoryOrderAfterMove(rows, active, c, dir);
    if (!order) return;
    setMoveError(false);
    reorder.mutate(order, { onError: () => setMoveError(true) });
  }

  useErrorToast(moveError && t("settings.budget.categories.actionError"));

  const row = (c: BudgetCategory) => {
    const label = categoryLabel(t, c);
    return (
      <ListRow
        key={c.id}
        label={t("settings.budget.categories.edit", { name: label })}
        onOpen={() => setEditing(c)}
        dimmed={c.archived}
        tile={
          <ListTile color={safeBudgetColor(c.color)}>
            <CategoryIcon icon={c.icon} className="size-4" />
          </ListTile>
        }
        title={
          <>
            <span data-testid="category-name" className="truncate">{label}</span>
            {c.systemKey !== null && (
              <ListBadge testId="system-lock" icon={<Lock aria-hidden />} title={t("settings.budget.categories.systemLocked")}>
                {t("settings.budget.categories.system")}
              </ListBadge>
            )}
          </>
        }
        subtitle={
          <span title={c.hint ?? undefined} className={c.hint ? "" : "opacity-60"}>
            {c.hint ?? t("settings.budget.categories.noHint")}
          </span>
        }
        extra={
          // Archived rows have no place in the order: it only ranks the
          // categories the pickers show.
          c.archived ? undefined : (
            <div className={ARROWS}>
              {([-1, 1] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  disabled={!categoryNeighbour(active, c, dir) || reorder.isPending}
                  onClick={() => runMove(c, dir)}
                  aria-label={t(dir < 0 ? "settings.budget.categories.moveUp" : "settings.budget.categories.moveDown", { name: label })}
                  className={ARROW_BTN}
                >
                  {dir < 0 ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
              ))}
            </div>
          )
        }
      />
    );
  };

  return (
    <div>
      <SettingsSurface
        title={t("settings.budget.categories.title")}
        action={
          <Button
            onClick={() => setEditing("new")}
            disabled={isPending || isError}
            padded={false}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs px-2.75 py-1.5"
          >
            <Plus className="size-4" />
            {t("settings.budget.categories.add")}
          </Button>
        }
      >
        {isError ? (
          <CardError onRetry={() => refetch()} className="h-64" />
        ) : isPending ? (
          <Skeleton>
            <ListHeadingBone />
            <List>
              {boneWidths(5).map((w) => (
                <ListRowBone key={w} width={w} />
              ))}
            </List>
          </Skeleton>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-faint">{t("settings.budget.categories.empty")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {BUDGET_KINDS.map((kind) => {
              const group = active.filter((c) => c.kind === kind);
              return group.length === 0 ? null : (
                <List key={kind} label={t(`settings.budget.categories.groups.${kind}`)}>
                  {group.map(row)}
                </List>
              );
            })}

            {archived.length > 0 && (
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                  className="-mx-2 flex h-8 w-fit cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-dim transition-colors duration-140 hover:text-fg"
                >
                  {t(showArchived ? "settings.budget.categories.hideArchived" : "settings.budget.categories.showArchived", { count: archived.length })}
                  {showArchived ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                {showArchived && <List>{archived.map(row)}</List>}
              </div>
            )}
          </div>
        )}
      </SettingsSurface>

      {editing && (
        <CategoryModal
          category={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onDelete={(c) => {
            setEditing(null);
            setDeleting(c);
          }}
        />
      )}
      {deleting && <DeleteCategoryModal category={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
