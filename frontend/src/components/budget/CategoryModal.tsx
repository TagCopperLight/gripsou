import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../Dialog";
import { ColorSwatchGrid } from "../ColorSwatchGrid";
import { FilledDot } from "./FilledDot";
import { CategoryIcon } from "./CategoryIcon";
import { Button } from "../Button";
import { Select } from "../Select";
import {
  useCreateBudgetCategory,
  useUpdateBudgetCategory,
  type BudgetCategory,
  type BudgetKind,
  type CategoryBody,
} from "../../api/budget";
import {
  BUDGET_ICONS,
  BUDGET_ICON_NAMES,
  BUDGET_KINDS,
  budgetErrorKey,
  categoryLabel,
  safeBudgetColor,
} from "../../lib/budget";
import { ACCOUNT_PALETTE } from "../../lib/palette";
import { withAlpha } from "../../lib/color";

type CategoryModalProps = {
  category?: BudgetCategory;
  onClose: () => void;
};

export function CategoryModal({ category, onClose }: CategoryModalProps) {
  const { t } = useTranslation();
  const create = useCreateBudgetCategory();
  const update = useUpdateBudgetCategory();
  const mutation = category ? update : create;

  // The label shown when the form opened. Comparing against it is what tells a
  // real rename apart from "the user never touched the name" — including when
  // the UI language changes mid-draft, which must not turn a seeded row into a
  // renamed one.
  const [initialDisplayName] = useState(() => (category ? categoryLabel(t, category) : ""));
  const [name, setName] = useState(initialDisplayName);
  const [kind, setKind] = useState<BudgetKind>(category?.kind ?? "expense");
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
  const body: CategoryBody = {
    name: storedName,
    color,
    icon,
    hint: hint.trim() || null,
    // The system row's kind is fixed; the select is disabled, and the body
    // re-sends what the backend already holds.
    kind: category?.systemKey ? category.kind : kind,
    archived: category?.archived ?? false,
  };

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

  const busy = mutation.isPending;
  // The system row stays editable for the things that are purely presentation —
  // name, colour, icon. Its kind is fixed, and its hint would never be read.
  const locked = Boolean(category?.systemKey);
  const previewColor = safeBudgetColor(color);

  return (
    <Dialog
      large
      busy={busy}
      title={t(category ? "settings.budget.categories.editTitle" : "settings.budget.categories.newTitle")}
      heading={
        <span data-testid="category-preview" className="truncate">
          {trimmed ||
            t(
              category
                ? "settings.budget.categories.editTitle"
                : "settings.budget.categories.newTitle",
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!trimmed || !dirty || busy}>
            {t(category ? "settings.budget.categories.save" : "settings.budget.categories.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t("settings.budget.categories.fieldName")} htmlFor="category-name">
          <input
            id="category-name"
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
          />
        </Field>

        <Field label={t("settings.budget.categories.fieldKind")} htmlFor="category-kind">
          <Select
            id="category-kind"
            value={kind}
            disabled={busy || locked}
            onChange={(v) => setKind(v as BudgetKind)}
            options={BUDGET_KINDS.map((k) => ({ value: k, label: t(`budget.kinds.${k}`) }))}
          />
          {locked && (
            <p className="text-fg-faint text-xs mt-1">{t("settings.budget.categories.kindLocked")}</p>
          )}
        </Field>

        <Field label={t("settings.budget.categories.fieldColor")}>
          <ColorSwatchGrid
            value={color}
            onChange={setColor}
            disabled={busy}
            swatchLabel={(c) => t("settings.budget.categories.colorLabel", { color: c })}
            customLabel={t("settings.budget.categories.customColor")}
          />
        </Field>

        <Field label={t("settings.budget.categories.fieldIcon")}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              aria-label={t("budget.icons.none")}
              aria-pressed={icon === null}
              onClick={() => setIcon(null)}
              className={`size-8 rounded-xl flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 bg-surface-2 ${
                icon === null ? "ring-2 ring-fg" : "hover:scale-105"
              }`}
            >
              <FilledDot className="size-4 text-fg-faint" />
            </button>
            {BUDGET_ICON_NAMES.map((n) => {
              const IconCmp = BUDGET_ICONS[n];
              return (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  aria-label={t(`budget.icons.${n}`)}
                  aria-pressed={icon === n}
                  onClick={() => setIcon(n)}
                  className={`size-8 rounded-xl flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 bg-surface-2 ${
                    icon === n ? "ring-2 ring-fg" : "hover:scale-105"
                  }`}
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
            disabled={busy || locked}
            onChange={(e) => setHint(e.target.value)}
            rows={3}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
          />
        </Field>

        {mutation.isError && (
          <p role="alert" className="text-red text-sm">
            {t(`settings.budget.categories.${budgetErrorKey(mutation.error)}`)}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-fg-faint text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}
