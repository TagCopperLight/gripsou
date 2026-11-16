import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Trash2 } from "lucide-react";

import { Dialog } from "../../../ui/Dialog";
import { Button } from "../../../ui/Button";
import { ColorSwatchGrid } from "../../../ui/ColorSwatchGrid";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextInput";
import { useCreateBudgetTag, useUpdateBudgetTag } from "../../../api/budget";
import type { BudgetTag } from "../../../api/wire";
import { safeBudgetColor } from "../../../lib/budget";
import { withAlpha } from "../../../lib/color";
import { budgetErrorKey, useBudgetErrorToast } from "../budgetErrors";

type TagModalProps = {
  tag?: BudgetTag;
  onClose: () => void;
  /** Asks to delete the tag: the caller confirms first. */
  onDelete: (tag: BudgetTag) => void;
};

export function TagModal({ tag, onClose, onDelete }: TagModalProps) {
  const { t } = useTranslation();
  const create = useCreateBudgetTag();
  const update = useUpdateBudgetTag();
  const mutation = tag ? update : create;

  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<string | null>(tag?.color ?? null);

  const trimmed = name.trim();
  const body = { name: trimmed, color };
  const dirty = !tag || trimmed !== tag.name || color !== tag.color;
  const busy = mutation.isPending;

  const submit = () => {
    if (!trimmed || busy || !dirty) return;
    if (tag) update.mutate({ id: tag.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  const failure = mutation.isError ? budgetErrorKey(mutation.error) : null;
  useBudgetErrorToast(failure, "settings.budget.tags", "duplicate");

  const title = t(tag ? "settings.budget.tags.editTitle" : "settings.budget.tags.newTitle");
  const preview = safeBudgetColor(color);

  return (
    <Dialog
      large
      busy={busy}
      title={title}
      heading={<span className="truncate">{trimmed || title}</span>}
      onClose={onClose}
      icon={
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: withAlpha(preview, 0.2), color: preview }}
        >
          <Tag className="size-5" />
        </span>
      }
      footer={
        <>
          {tag && (
            <Button variant="ghostDanger" onClick={() => onDelete(tag)} className="mr-auto inline-flex items-center gap-1.5">
              <Trash2 className="size-4" />
              {t("settings.budget.tags.delete")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={!trimmed || !dirty}
            busy={busy}
            busyLabel={t(tag ? "common.busy.saving" : "common.busy.creating")}
          >
            {t(tag ? "settings.budget.tags.save" : "settings.budget.tags.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label={t("settings.budget.tags.fieldName")}
          htmlFor="tag-name"
          error={failure === "duplicate" && t("settings.budget.tags.duplicate")}
        >
          <TextInput
            id="tag-name"
            type="text"
            autoFocus
            value={name}
            invalid={failure === "duplicate"}
            onChange={(e) => {
              setName(e.target.value);
              if (failure === "duplicate") mutation.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>

        <Field label={t("settings.budget.tags.fieldColor")}>
          <ColorSwatchGrid
            value={color}
            onChange={setColor}
            clearLabel={t("settings.budget.tags.clearColor")}
            swatchLabel={(c) => t("settings.budget.tags.paletteLabel", { color: c })}
            customLabel={t("settings.budget.tags.customColor")}
          />
        </Field>
      </div>
    </Dialog>
  );
}
