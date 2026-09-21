import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { useBudget } from "./budgetContext";
import { CategoryChooser } from "./CategoryChooser";
import { TagChooser } from "./TagChooser";
import { CategoryChip } from "./CategoryChip";
import { TagChip } from "./TagChip";
import { Toggle } from "../Toggle";
import { useBudgetCategories, useBudgetTags } from "../../api/budget";
import type { TypeBucket } from "../../api/types";

const BUCKETS: TypeBucket[] = ["all", "in", "out", "lots"];

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-[11px] font-medium tracking-wide text-fg-faint">{title}</p>
      {children}
    </div>
  );
}

/** Part 2 of the search surface: four columns, no separators (§2.2). */
export function FilterPanel() {
  const { t } = useTranslation();
  const { filters, patchFilters } = useBudget();
  const [open, setOpen] = useState<"categories" | "tags" | null>(null);
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
          <div className="flex flex-col items-start gap-1">
            {BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                data-testid={`bucket-${b}`}
                aria-pressed={filters.bucket === b}
                onClick={() => patchFilters({ bucket: b })}
                className={`cursor-pointer rounded-lg px-2 py-1 text-xs ${
                  filters.bucket === b ? "bg-surface-3 text-fg" : "text-fg-faint hover:text-fg-dim"
                }`}
              >
                {t(`budget.transactions.buckets.${b}`)}
              </button>
            ))}
          </div>
        </Column>
      </div>

      <div data-testid="column-categories">
        <Column title={t("budget.transactions.columns.category").toUpperCase()}>
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.categoryIds.map((id) => {
              const c = categories.find((x) => x.id === id);
              return c ? (
                <button
                  key={id}
                  type="button"
                  data-testid={`filter-category-${id}`}
                  onClick={() => toggleCategory(id)}
                  className="cursor-pointer"
                >
                  <CategoryChip category={c} />
                </button>
              ) : null;
            })}
            <button
              type="button"
              data-testid="add-category-filter"
              aria-label={t("budget.transactions.filterByCategory")}
              onClick={() => setOpen("categories")}
              className="cursor-pointer rounded-lg bg-surface-2 p-1 text-fg-faint hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </Column>
      </div>

      <div data-testid="column-tags">
        <Column title={t("budget.transactions.columns.tags").toUpperCase()}>
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.tagIds.map((id) => {
              const tag = tags.find((x) => x.id === id);
              return tag ? (
                <button
                  key={id}
                  type="button"
                  data-testid={`filter-tag-${id}`}
                  onClick={() => toggleTag(id)}
                  className="cursor-pointer"
                >
                  <TagChip tag={tag} />
                </button>
              ) : null;
            })}
            <button
              type="button"
              data-testid="add-tag-filter"
              aria-label={t("budget.transactions.filterByTag")}
              onClick={() => setOpen("tags")}
              className="cursor-pointer rounded-lg bg-surface-2 p-1 text-fg-faint hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </Column>
      </div>

      <div data-testid="column-others">
        <Column title={t("budget.transactions.columns.others").toUpperCase()}>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3 text-xs text-fg-dim">
              {t("budget.uncategorized")}
              <Toggle
                checked={filters.uncategorized}
                onChange={(v) => patchFilters({ uncategorized: v })}
                aria-label={t("budget.uncategorized")}
                data-testid="toggle-uncategorized"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs text-fg-dim">
              {t("budget.needsReview")}
              <Toggle
                checked={filters.needsReview}
                onChange={(v) => patchFilters({ needsReview: v })}
                aria-label={t("budget.needsReview")}
                data-testid="toggle-needs-review"
              />
            </label>
          </div>
        </Column>
      </div>

      {open === "categories" && (
        <CategoryChooser
          mode="multi"
          selectedIds={filters.categoryIds}
          onToggle={toggleCategory}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "tags" && (
        <TagChooser
          selectedIds={filters.tagIds}
          onToggle={toggleTag}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
