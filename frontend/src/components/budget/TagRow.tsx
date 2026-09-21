import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Trash2 } from "lucide-react";

import { TagChip } from "./TagChip";
import { useUpdateBudgetTag, type BudgetTag, type TagBody } from "../../api/budget";
import { BUDGET_PALETTE, budgetErrorKey } from "../../lib/budget";

type TagRowProps = {
  tag: BudgetTag;
  onDelete: () => void;
};

/** The swatch grid from the category modal, shrunk to sit inline on a row. */
const SWATCH =
  "size-4.5 rounded-md flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 disabled:cursor-not-allowed";

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
  // The picker swatch stands in for "a colour off the palette", so it only
  // reads as selected when the stored colour is not one of the presets.
  const customColor = tag.color !== null && !BUDGET_PALETTE.includes(tag.color);

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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 pr-3">
        {editing ? (
          <input
            autoFocus
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") cancelEdit();
            }}
            className="bg-surface-2 rounded-lg px-2.5 py-1 text-sm text-fg outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
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

          <div className="flex items-center gap-1">
            {/* "No colour" leads the line, drawn as an empty square struck
                through — the absence of a colour still needs a swatch to sit
                in, otherwise the row's colours start at a different x. */}
            <button
              type="button"
              disabled={pending}
              aria-label={t("settings.budget.tags.clearColor")}
              aria-pressed={tag.color === null}
              onClick={() => save({ name: tag.name, color: null })}
              className={`${SWATCH} bg-surface-3 ${
                tag.color === null ? "ring-2 ring-fg" : "hover:scale-105"
              }`}
            >
              <svg viewBox="0 0 12 12" aria-hidden className="size-full">
                <line x1="1.5" y1="10.5" x2="10.5" y2="1.5" stroke="currentColor"
                  strokeWidth="1" className="text-fg-faint" />
              </svg>
            </button>
            {BUDGET_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                disabled={pending}
                aria-label={t("settings.budget.tags.paletteLabel", { color: c })}
                aria-pressed={c === tag.color}
                onClick={() => save({ name: tag.name, color: c })}
                className={`${SWATCH} ${c === tag.color ? "ring-2 ring-fg" : "hover:scale-105"}`}
                style={{ background: c }}
              >
                {c === tag.color && <Check className="size-3 text-black/80" />}
              </button>
            ))}
            {/* The native colour input has its own intrinsic height, so it is
                stretched invisibly over a square of our own — same trick as the
                category modal, which is where this line comes from. */}
            <label
              className={`${SWATCH} relative ${
                customColor ? "ring-2 ring-fg" : "bg-surface-2 hover:scale-105"
              } ${pending ? "opacity-40" : ""}`}
              style={{ background: customColor ? tag.color! : undefined }}
            >
              <span className="sr-only">{t("settings.budget.tags.customColor")}</span>
              <Pencil className={`size-3 ${customColor ? "text-black/80" : "text-fg-faint"}`} />
              <input
                type="color"
                aria-label={t("settings.budget.tags.customColor")}
                value={/^#[0-9a-fA-F]{6}$/.test(tag.color ?? "") ? tag.color! : "#000000"}
                disabled={pending}
                onChange={(e) => save({ name: tag.name, color: e.target.value })}
                className="absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
            </label>
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

      {update.isError && (
        <p role="alert" className="text-red text-xs">
          {t(`settings.budget.tags.${budgetErrorKey(update.error)}`)}
        </p>
      )}
    </div>
  );
}
