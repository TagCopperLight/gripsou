import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "../../../ui/FieldError";
import { Plus } from "lucide-react";

import { Surface } from "../../../ui/Surface";
import { CardState } from "../../../ui/CardState";
import { Button } from "../../../ui/Button";
import { useBudgetTags, useCreateBudgetTag } from "../../../api/budget";
import type { BudgetTag } from "../../../api/wire";
import { budgetErrorKey, useBudgetErrorToast } from "../budgetErrors";
import { TagRow } from "./TagRow";
import { DeleteTagModal } from "./DeleteTagModal";
import { TextInput } from "../../../ui/TextInput";

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

  const failure = create.isError ? budgetErrorKey(create.error) : null;
  useBudgetErrorToast(failure, "settings.budget.tags", "duplicate");

  return (
    <div>
      <Surface className="w-full">
        <div className="flex flex-col p-4 md:p-5">
          <h2 className="text-fg font-semibold text-sm">{t("settings.budget.tags.title")}</h2>

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

              <div className="mt-4 flex items-center gap-4">
                <TextInput
                  id="new-tag-name"
                  type="text"
                  value={draft}
                  aria-label={t("settings.budget.tags.nameLabel")}
                  placeholder={t("settings.budget.tags.nameLabel")}
                  disabled={create.isPending}
                  invalid={failure === "duplicate"}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (failure === "duplicate") create.reset();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  className="max-w-112"
                />
                {/* The same primary action as the category table's Add; the
                    padding matches the field beside it, so the two share a
                    baseline and a height. */}
                <Button
                  onClick={submit}
                  disabled={!draft.trim() || create.isPending}
                  padded={false}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3.5 py-2.25"
                >
                  <Plus className="size-4" />
                  {t("settings.budget.tags.add")}
                </Button>
              </div>

              {failure === "duplicate" && (
                <div className="mt-1.5">
                  <FieldError>{t("settings.budget.tags.duplicate")}</FieldError>
                </div>
              )}
            </>
          )}
        </div>
      </Surface>

      {deleting && <DeleteTagModal tag={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
