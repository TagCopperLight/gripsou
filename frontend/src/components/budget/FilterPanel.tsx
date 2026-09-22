import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { useBudget } from "./budgetContext";
import { CategoryChooser } from "./CategoryChooser";
import { TagChooser } from "./TagChooser";
import { CategoryChip } from "./CategoryChip";
import { TagChip } from "./TagChip";
import { useBudgetCategories, useBudgetTags } from "../../api/budget";
import { OTHER_FLAGS, TYPE_BUCKETS, categoryLabel } from "../../lib/budget";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* The same head treatment as the transactions table: 11px mono, faint,
       *  wide-tracked — a column heading reads as a heading in both places. */}
      <p className="font-mono text-[11px] font-medium tracking-wide text-fg-faint">{title}</p>
      {children}
    </div>
  );
}

/** Part 2 of the search surface: four columns, no separators (§2.2). */
export function FilterPanel() {
  const { t } = useTranslation();
  const { filters, patchFilters } = useBudget();
  // The chooser hangs under the control that opened it, so the "+" that was
  // clicked is kept alongside the open state.
  const [open, setOpen] = useState<"categories" | "tags" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const openChooser = (which: "categories" | "tags") => (e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
    // A second click on the same "+" closes it: `Popover` exempts its anchor
    // from the outside-click close, so the toggle has to live here.
    setOpen((prev) => (prev === which ? null : which));
  };
  const categories = useBudgetCategories().data ?? [];
  const tags = useBudgetTags().data ?? [];

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  // Updater form: two toggles batched into one tick must each derive from the
  // other's write, not from the same pre-batch `filters` snapshot.
  const toggleCategory = (id: string) =>
    patchFilters((prev) => ({ categoryIds: toggleIn(prev.categoryIds, id) }));
  const toggleTag = (id: string) =>
    patchFilters((prev) => ({ tagIds: toggleIn(prev.tagIds, id) }));

  return (
    <div data-testid="filter-panel" className="grid grid-cols-2 gap-6 py-3 md:grid-cols-4">
      <div data-testid="column-type">
        <Column title={t("budget.transactions.columns.type").toUpperCase()}>
          {/* Two columns rather than one stack: the four options are not a
           *  flat list of peers. `all` and `lots` choose *what kind of row* you
           *  are looking at, `in` and `out` split cash by direction — so the
           *  grid puts a scope choice beside its cash counterpart instead of
           *  burying the distinction in a column of four. */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {TYPE_BUCKETS.map(({ key, icon: Icon, tint }) => (
              <button
                key={key}
                type="button"
                data-testid={`bucket-${key}`}
                aria-pressed={filters.bucket === key}
                onClick={() => patchFilters({ bucket: key })}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors duration-140 ${
                  filters.bucket === key
                    ? "bg-surface-3 font-medium text-fg"
                    : "text-fg-faint hover:text-fg-dim"
                }`}
              >
                <Icon className={`size-3.5 shrink-0 ${tint}`} aria-hidden="true" />
                <span className="truncate">{t(`budget.transactions.buckets.${key}`)}</span>
              </button>
            ))}
          </div>
        </Column>
      </div>

      <div data-testid="column-categories">
        <Column title={t("budget.transactions.columns.category").toUpperCase()}>
          {/* The "+" leads, the chips follow: it then keeps its place as the
           *  selection grows, so the chooser hanging under it does not walk
           *  across the column with every pick. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="add-category-filter"
              aria-label={t("budget.transactions.filterByCategory")}
              onClick={openChooser("categories")}
              className="cursor-pointer rounded-lg bg-surface p-1 text-fg-faint hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
            {filters.categoryIds.map((id) => {
              const c = categories.find((x) => x.id === id);
              return c ? (
                <button
                  key={id}
                  type="button"
                  data-testid={`filter-category-${id}`}
                  aria-label={`${t("budget.transactions.removeFilter")}: ${categoryLabel(t, c)}`}
                  onClick={() => toggleCategory(id)}
                  className="group cursor-pointer opacity-100 transition-opacity duration-140 hover:opacity-70"
                >
                  <CategoryChip category={c} removable />
                </button>
              ) : null;
            })}
          </div>
        </Column>
      </div>

      <div data-testid="column-tags">
        <Column title={t("budget.transactions.columns.tags").toUpperCase()}>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="add-tag-filter"
              aria-label={t("budget.transactions.filterByTag")}
              onClick={openChooser("tags")}
              className="cursor-pointer rounded-lg bg-surface p-1 text-fg-faint hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
            {filters.tagIds.map((id) => {
              const tag = tags.find((x) => x.id === id);
              return tag ? (
                <button
                  key={id}
                  type="button"
                  data-testid={`filter-tag-${id}`}
                  aria-label={`${t("budget.transactions.removeFilter")}: ${tag.name}`}
                  onClick={() => toggleTag(id)}
                  className="group cursor-pointer opacity-100 transition-opacity duration-140 hover:opacity-70"
                >
                  <TagChip tag={tag} removable />
                </button>
              ) : null;
            })}
          </div>
        </Column>
      </div>

      <div data-testid="column-others">
        <Column title={t("budget.transactions.columns.others").toUpperCase()}>
          {/* The same two-column grid as TYPE, and the same press treatment —
           *  these read as flags on the same surface, so they should not look
           *  like a different kind of control. Unlike TYPE they are
           *  independent and each is free to be off; they carry no icon,
           *  having no colour or shape of their own to stand for. A third
           *  flag lands on the second line without any change here. */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {OTHER_FLAGS.map(({ key, labelKey, icon: Icon, tint, strokeWidth }) => {
              const on = filters[key];
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`toggle-${key === "needsReview" ? "needs-review" : key}`}
                  aria-pressed={on}
                  onClick={() => patchFilters({ [key]: !on })}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors duration-140 ${
                    on ? "bg-surface-3 font-medium text-fg" : "text-fg-faint hover:text-fg-dim"
                  }`}
                >
                  <Icon
                    className={`size-3.5 shrink-0 ${tint}`}
                    strokeWidth={strokeWidth}
                    aria-hidden="true"
                  />
                  <span className="truncate">{t(labelKey)}</span>
                </button>
              );
            })}
          </div>
        </Column>
      </div>

      {open === "categories" && (
        <CategoryChooser
          mode="multi"
          selectedIds={filters.categoryIds}
          onToggle={toggleCategory}
          onClose={() => setOpen(null)}
          anchor={anchor}
        />
      )}
      {open === "tags" && (
        <TagChooser
          selectedIds={filters.tagIds}
          onToggle={toggleTag}
          onClose={() => setOpen(null)}
          anchor={anchor}
        />
      )}
    </div>
  );
}
