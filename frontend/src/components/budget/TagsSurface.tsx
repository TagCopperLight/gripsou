import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { Surface } from "../Surface";
import { CardState } from "../CardState";
import { useBudgetTags, useCreateBudgetTag, type BudgetTag } from "../../api/budget";
import { budgetErrorKey } from "../../lib/budget";
import { TagRow } from "./TagRow";
import { DeleteTagModal } from "./DeleteTagModal";

export function TagsSurface() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useBudgetTags();
  const create = useCreateBudgetTag();

  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<BudgetTag | null>(null);

  const rows = data ?? [];

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || create.isPending) return;
    create.mutate(
      { name: trimmed, color: null },
      { onSuccess: () => setDraft("") },
    );
  };

  return (
    <div>
      <Surface className="w-full">
        <div className="flex flex-col p-4 md:p-5">
          <h2 className="text-fg font-semibold text-sm">
            {t("settings.budget.tags.title")}
            {!isLoading && !isError && (
              <span className="text-fg-faint font-normal ml-2">
                <span className="mr-2">·</span>
                {t("settings.budget.tags.tagsCount", { count: rows.length })}
              </span>
            )}
          </h2>

          {isLoading ? (
            <CardState variant="loading" className="mt-4 h-40" />
          ) : isError ? (
            <CardState variant="error" onRetry={() => refetch()} className="mt-4 h-40" />
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-sm text-fg-faint py-6">{t("settings.budget.tags.empty")}</p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {rows.map((tag) => (
                    <TagRow key={tag.id} tag={tag} onDelete={() => setDeleting(tag)} />
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <input
                  id="new-tag-name"
                  type="text"
                  value={draft}
                  aria-label={t("settings.budget.tags.nameLabel")}
                  placeholder={t("settings.budget.tags.nameLabel")}
                  disabled={create.isPending}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  className="w-112 max-w-full bg-surface-2 rounded-xl px-3 py-2 text-sm text-fg outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
                />
                {/* Padding and text size mirror the field beside it, so the
                    two share a baseline and a height. */}
                <button
                  type="button"
                  onClick={submit}
                  disabled={!draft.trim() || create.isPending}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-surface-3 px-3 py-2 text-sm font-medium text-fg cursor-pointer transition-colors duration-140 hover:bg-surface-3/70 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="size-4" />
                  {t("settings.budget.tags.add")}
                </button>
              </div>

              {create.isError && (
                <p role="alert" className="mt-2 text-xs text-red">
                  {t(`settings.budget.tags.${budgetErrorKey(create.error)}`)}
                </p>
              )}
            </>
          )}
        </div>
      </Surface>

      {deleting && <DeleteTagModal tag={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
