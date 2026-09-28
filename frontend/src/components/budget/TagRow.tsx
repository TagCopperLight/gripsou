import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // While the native picker is being dragged, the colour lives here and only
  // previews: browsers fire an input event per pixel, and saving each one
  // would send a request and refetch the tags dozens of times a second.
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const shownColor = colorDraft ?? tag.color;
  const customColor = shownColor !== null && !BUDGET_PALETTE.includes(shownColor);

  // Every write is a full body, so a colour change carries the stored name and
  // a rename carries the current colour.
  const save = (body: TagBody, opts?: { onSuccess?: () => void }) =>
    update.mutate({ id: tag.id, body }, opts);

  // Saved once, when the picker commits: the native `change` event (the
  // picker closed or the value was confirmed), with blur as a fallback.
  // React's `onChange` is the per-tick `input` event, so it cannot be used.
  const colorInput = useRef<HTMLInputElement>(null);
  const commitColor = useRef(() => {});
  useLayoutEffect(() => {
    commitColor.current = () => {
      const value = colorInput.current?.value;
      setColorDraft(null);
      // A blur right after the commit finds the save in flight or done.
      if (!value || pending || value.toLowerCase() === tag.color?.toLowerCase()) return;
      save({ name: tag.name, color: value });
    };
  });
  useEffect(() => {
    const el = colorInput.current;
    if (!el) return;
    const onCommit = () => commitColor.current();
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, []);

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

          <div
            role="group"
            aria-label={t("settings.budget.tags.colorLabel", { name: tag.name })}
            className="flex items-center gap-1"
          >
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
              style={{ background: customColor ? shownColor! : undefined }}
            >
              <span className="sr-only">{t("settings.budget.tags.customColor")}</span>
              <Pencil className={`size-3 ${customColor ? "text-black/80" : "text-fg-faint"}`} />
              <input
                type="color"
                aria-label={t("settings.budget.tags.customColor")}
                ref={colorInput}
                value={/^#[0-9a-fA-F]{6}$/.test(shownColor ?? "") ? shownColor! : "#000000"}
                disabled={pending}
                onChange={(e) => setColorDraft(e.target.value)}
                onBlur={() => commitColor.current()}
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
