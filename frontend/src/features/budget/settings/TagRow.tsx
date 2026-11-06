import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "../../../ui/FieldError";
import { Pencil, Trash2 } from "lucide-react";

import { TagChip } from "../TagChip";
import { ColorSwatchGrid } from "../../../ui/ColorSwatchGrid";
import { TextInput } from "../../../ui/TextInput";
import { useUpdateBudgetTag } from "../../../api/budget";
import type { BudgetTag, TagBody } from "../../../api/wire";
import { budgetErrorKey, useBudgetErrorToast } from "../budgetErrors";

type TagRowProps = {
  tag: BudgetTag;
  onDelete: () => void;
};

/** Sized and padded like the category table's action buttons, so the bin at
 *  the end of the row lands on the same column as the table's. */
const ACTION_BTN =
  "p-1.5 rounded-lg text-fg hover:bg-surface-2 transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

const DELETE_BTN =
  "p-1.5 rounded-lg text-red hover:bg-surface-2 transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

export function TagRow({ tag, onDelete }: TagRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);
  const update = useUpdateBudgetTag();
  const pending = update.isPending;
  // Every write is a full body, so a colour change carries the stored name and
  // a rename carries the current colour.
  const save = (body: TagBody, opts?: { onSuccess?: () => void }) =>
    update.mutate({ id: tag.id, body }, opts);

  const startEdit = () => {
    setDraft(tag.name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(tag.name);
  };

  const submitRename = () => {
    if (pending) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    save({ name: trimmed, color: tag.color }, { onSuccess: () => setEditing(false) });
  };

  const failure = update.isError ? budgetErrorKey(update.error) : null;
  useBudgetErrorToast(failure, "settings.budget.tags", "duplicate");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 pr-3">
        {editing ? (
          <TextInput
            inputSize="sm"
            autoFocus
            value={draft}
            disabled={pending}
            invalid={failure === "duplicate"}
            onChange={(e) => {
              setDraft(e.target.value);
              if (failure === "duplicate") update.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") cancelEdit();
            }}
          />
        ) : (
          <TagChip tag={tag} />
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* The count leads the fixed-width control group, so it starts at the
              same x on every row rather than trailing a variable chip — and its
              digits grow rightwards from that edge. */}
          <span className="text-fg-faint text-xs tabular-nums w-8 shrink-0 text-left">
            {tag.txCount}
          </span>

          <div
            role="group"
            aria-label={t("settings.budget.tags.colorLabel", { name: tag.name })}
          >
            {/* Every pick is a write, so the picker saves once, when it closes:
                saving each step of a drag would send a request and refetch the
                tags dozens of times a second. */}
            <ColorSwatchGrid
              size="inline"
              live={false}
              value={tag.color}
              onChange={(color) => save({ name: tag.name, color })}
              disabled={pending}
              clearLabel={t("settings.budget.tags.clearColor")}
              swatchLabel={(color) => t("settings.budget.tags.paletteLabel", { color })}
              customLabel={t("settings.budget.tags.customColor")}
            />
          </div>

          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={submitRename}
                  className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2/70 transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("settings.budget.tags.save")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancelEdit}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-fg-faint hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={startEdit}
                aria-label={t("settings.budget.tags.edit", { name: tag.name })}
                className={ACTION_BTN}
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              aria-label={t("settings.budget.tags.delete", { name: tag.name })}
              className={DELETE_BTN}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {failure === "duplicate" && <FieldError>{t("settings.budget.tags.duplicate")}</FieldError>}
    </div>
  );
}
