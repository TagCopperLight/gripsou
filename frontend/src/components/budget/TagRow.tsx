import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Palette, Pencil, Trash2 } from "lucide-react";

import { TagChip } from "./TagChip";
import { useUpdateBudgetTag, type BudgetTag, type TagBody } from "../../api/budget";
import { ACCOUNT_PALETTE } from "../../lib/palette";
import { budgetErrorKey, safeBudgetColor } from "../../lib/budget";

type TagRowProps = {
  tag: BudgetTag;
  onDelete: () => void;
};

export function TagRow({ tag, onDelete }: TagRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);
  const [colorOpen, setColorOpen] = useState(false);
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

  const color = safeBudgetColor(tag.color);
  const swatchColor = tag.color ? color : "transparent";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
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

        <span className="text-fg-faint text-xs">{tag.txCount}</span>

        <div className="relative">
          <button
            type="button"
            disabled={pending}
            aria-label={t("settings.budget.tags.colorLabel", { name: tag.name })}
            onClick={() => setColorOpen((v) => !v)}
            className="flex size-6 items-center justify-center rounded-full border border-border/60 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: swatchColor }}
          >
            {!tag.color && <Palette className="size-3.5 text-fg-faint" />}
          </button>
          {colorOpen && (
            <div className="absolute z-10 mt-1 flex flex-wrap gap-1.5 rounded-xl bg-surface p-2 shadow-lg w-40">
              {ACCOUNT_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("settings.budget.tags.paletteLabel", { color: c })}
                  onClick={() => {
                    setColorOpen(false);
                    save({ name: tag.name, color: c });
                  }}
                  className="size-6 rounded-lg flex items-center justify-center cursor-pointer transition-transform duration-140 hover:scale-105"
                  style={{ background: c }}
                >
                  {c === tag.color && <Check className="size-3.5 text-black/80" />}
                </button>
              ))}
              <button
                type="button"
                aria-label={t("settings.budget.tags.clearColor")}
                onClick={() => {
                  setColorOpen(false);
                  save({ name: tag.name, color: null });
                }}
                className="w-full text-left text-[11px] text-fg-faint hover:text-fg transition-colors duration-140 cursor-pointer mt-1"
              >
                {t("settings.budget.tags.clearColor")}
              </button>
            </div>
          )}
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
              className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            aria-label={t("settings.budget.tags.delete", { name: tag.name })}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="size-4" />
          </button>
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
