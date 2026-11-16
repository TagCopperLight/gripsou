import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Lock, Trash2 } from "lucide-react";

import { Dialog } from "../../../ui/Dialog";
import { ColorSwatchGrid } from "../../../ui/ColorSwatchGrid";
import { FilledDot } from "../FilledDot";
import { CategoryIcon } from "../CategoryIcon";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextInput";
import { Select } from "../../../ui/Select";
import { useCreateBudgetCategory, useUpdateBudgetCategory, categoryBody } from "../../../api/budget";
import type { BudgetCategory, CategoryBody, CategoryKind } from "../../../api/wire";
import { BUDGET_KINDS, categoryLabel, safeBudgetColor } from "../../../lib/budget";
import { BUDGET_ICONS, BUDGET_ICON_NAMES } from "../budgetIcons";
import { budgetErrorKey, useBudgetErrorToast } from "../budgetErrors";
import { ListBadge } from "./SettingsList";
import { ACCOUNT_PALETTE } from "../../../lib/palette";
import { withAlpha } from "../../../lib/color";

/** An icon choice. The selected one is marked by a border, not a ring: a
 *  ring is a shadow, which the browser doesn't snap to screen pixels, so at a
 *  fractional display scale its sides come out unequal. */
const ICON_SWATCH =
  "size-8 rounded-xl border-[1.5px] flex items-center justify-center cursor-pointer transition-transform duration-140 bg-surface-2";

type CategoryModalProps = {
  category?: BudgetCategory;
  onClose: () => void;
  /** Asks to delete the category: the caller confirms first. */
  onDelete: (category: BudgetCategory) => void;
};

export function CategoryModal({ category, onClose, onDelete }: CategoryModalProps) {
  const { t } = useTranslation();
  const create = useCreateBudgetCategory();
  const update = useUpdateBudgetCategory();
  // Its own mutation, so only the button that was pressed says it is busy.
  const archive = useUpdateBudgetCategory();
  const mutation = category ? update : create;

  // The label shown when the form opened. Comparing against it is what tells a
  // real rename apart from "the user never touched the name" — including when
  // the UI language changes mid-draft, which must not turn a seeded row into a
  // renamed one.
  const [initialDisplayName] = useState(() => (category ? categoryLabel(t, category) : ""));
  const [name, setName] = useState(initialDisplayName);
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "expense");
  const [color, setColor] = useState(category?.color ?? ACCOUNT_PALETTE[0]);
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [hint, setHint] = useState(category?.hint ?? "");

  const trimmed = name.trim();
  // A seeded row's name is "unchanged" if it matches either the label the
  // modal opened with, or the label under the *current* language — the
  // latter covers a language switch mid-draft, and someone retyping the
  // translated label by hand, without treating either as a real rename.
  const unchanged =
    Boolean(category?.defaultKey) &&
    (trimmed === initialDisplayName || trimmed === categoryLabel(t, category!));
  const storedName = category && unchanged ? category.name : trimmed;
  const fields = {
    name: storedName,
    color,
    icon,
    hint: hint.trim() || null,
    // The system row's kind is fixed; the select is disabled, and the body
    // re-sends what the backend already holds.
    kind: category?.systemKey ? category.kind : kind,
  };
  const body: CategoryBody = category ? categoryBody(category, fields) : { ...fields, archived: false };

  const dirty =
    !category ||
    body.name !== category.name ||
    body.color !== category.color ||
    body.icon !== category.icon ||
    body.hint !== category.hint ||
    body.kind !== category.kind;

  const submit = () => {
    if (!trimmed || mutation.isPending || !dirty) return;
    if (category) update.mutate({ id: category.id, body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  const busy = mutation.isPending || archive.isPending;
  // The system row stays editable for the things that are purely presentation —
  // name, colour, icon. Its kind is fixed, and its hint would never be read.
  const locked = Boolean(category?.systemKey);
  const previewColor = safeBudgetColor(color);

  const failure = mutation.isError ? budgetErrorKey(mutation.error) : null;
  useBudgetErrorToast(failure, "settings.budget.categories", "duplicate");
  useBudgetErrorToast(archive.isError ? budgetErrorKey(archive.error) : null, "settings.budget.categories", "duplicate");

  return (
    <Dialog
      large
      busy={busy}
      title={t(category ? "settings.budget.categories.editTitle" : "settings.budget.categories.newTitle")}
      heading={
        <span className="flex min-w-0 items-center gap-2.5">
          <span data-testid="category-preview" className="truncate">
            {trimmed ||
              t(
                category
                  ? "settings.budget.categories.editTitle"
                  : "settings.budget.categories.newTitle",
              )}
          </span>
          {locked && (
            <ListBadge icon={<Lock aria-hidden />} title={t("settings.budget.categories.systemLocked")}>
              {t("settings.budget.categories.system")}
            </ListBadge>
          )}
          {category?.archived && (
            <ListBadge icon={<Archive aria-hidden />}>{t("settings.budget.categories.archivedBadge")}</ListBadge>
          )}
        </span>
      }
      onClose={onClose}
      icon={
        // Square-to-icon and square-to-text proportions mirror the category
        // chip in the table (size-7 square, size-4 icon, 14px label).
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: withAlpha(previewColor, 0.22) }}
        >
          <CategoryIcon icon={icon} className="size-5.5" style={{ color: previewColor }} />
        </span>
      }
      footer={
        <>
          {/* The system row can be renamed and restyled, never archived or
              deleted. */}
          {category && !locked && (
            <span className="mr-auto flex items-center gap-1">
              <Button
                variant="ghost"
                busy={archive.isPending}
                busyLabel={t("common.busy.saving")}
                onClick={() =>
                  archive.mutate(
                    { id: category.id, body: categoryBody(category, { archived: !category.archived }) },
                    { onSuccess: onClose },
                  )
                }
                className="inline-flex items-center gap-1.5"
              >
                {category.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                {t(category.archived ? "settings.budget.categories.restore" : "settings.budget.categories.archive")}
              </Button>
              <Button variant="ghostDanger" onClick={() => onDelete(category)} className="inline-flex items-center gap-1.5">
                <Trash2 className="size-4" />
                {t("settings.budget.categories.delete")}
              </Button>
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={!trimmed || !dirty}
            busy={busy}
            busyLabel={t(category ? "common.busy.saving" : "common.busy.creating")}
          >
            {t(category ? "settings.budget.categories.save" : "settings.budget.categories.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label={t("settings.budget.categories.fieldName")}
          htmlFor="category-name"
          error={failure === "duplicate" && t("settings.budget.categories.duplicate")}
        >
          <TextInput
            id="category-name"
            type="text"
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

        <Field label={t("settings.budget.categories.fieldKind")} htmlFor="category-kind">
          <Select
            id="category-kind"
            value={kind}
            disabled={locked}
            onChange={(v) => setKind(v as CategoryKind)}
            options={BUDGET_KINDS.map((k) => ({ value: k, label: t(`budget.kinds.${k}`) }))}
          />
        </Field>

        <Field label={t("settings.budget.categories.fieldColor")}>
          <ColorSwatchGrid
            value={color}
            onChange={setColor}
            swatchLabel={(c) => t("settings.budget.categories.colorLabel", { color: c })}
            customLabel={t("settings.budget.categories.customColor")}
          />
        </Field>

        <Field label={t("settings.budget.categories.fieldIcon")}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label={t("budget.icons.none")}
              title={t("budget.icons.none")}
              aria-pressed={icon === null}
              onClick={() => setIcon(null)}
              className={`${ICON_SWATCH} ${icon === null ? "border-fg" : "border-transparent hover:scale-105"}`}
            >
              <FilledDot className="size-4 text-fg-faint" />
            </button>
            {BUDGET_ICON_NAMES.map((n) => {
              const IconCmp = BUDGET_ICONS[n];
              return (
                <button
                  key={n}
                  type="button"
                  aria-label={t(`budget.icons.${n}`)}
                  title={t(`budget.icons.${n}`)}
                  aria-pressed={icon === n}
                  onClick={() => setIcon(n)}
                  className={`${ICON_SWATCH} ${icon === n ? "border-fg" : "border-transparent hover:scale-105"}`}
                >
                  <IconCmp className="size-4 text-fg" />
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("settings.budget.categories.fieldHint")} htmlFor="category-hint">
          <textarea
            id="category-hint"
            value={hint}
            disabled={locked}
            onChange={(e) => setHint(e.target.value)}
            rows={3}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none ring-inset focus:ring-1 focus:ring-green disabled:opacity-60"
          />
        </Field>
      </div>
    </Dialog>
  );
}
