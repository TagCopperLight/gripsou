import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Dot } from "lucide-react";

import { BudgetDialog } from "./BudgetDialog";
import { Button } from "../Button";
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
  const PreviewIcon = icon ? BUDGET_ICONS[icon] : null;
  const previewColor = safeBudgetColor(color);

  return (
    <BudgetDialog
      large
      busy={busy}
      title={t(category ? "settings.budget.categories.editTitle" : "settings.budget.categories.newTitle")}
      onClose={onClose}
      icon={
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: withAlpha(previewColor, 0.22) }}
        >
          {PreviewIcon ? (
            <PreviewIcon className="size-4" style={{ color: previewColor }} />
          ) : (
            <Dot className="size-4" style={{ color: previewColor }} />
          )}
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
        <div className="flex items-center justify-between bg-surface-2 rounded-2xl px-4 py-3.5">
          <span
            data-testid="category-preview"
            className="text-fg font-semibold text-[15px] truncate"
          >
            {trimmed || t("settings.budget.categories.newTitle")}
          </span>
        </div>

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
          <select
            id="category-kind"
            value={kind}
            disabled={busy || Boolean(category?.systemKey)}
            onChange={(e) => setKind(e.target.value as BudgetKind)}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
          >
            {BUDGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`budget.kinds.${k}`)}
              </option>
            ))}
          </select>
          {category?.systemKey && (
            <p className="text-fg-faint text-xs mt-1">{t("settings.budget.categories.kindLocked")}</p>
          )}
        </Field>

        <Field label={t("settings.budget.categories.fieldColor")}>
          <div className="flex flex-wrap gap-2 items-center">
            {ACCOUNT_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                disabled={busy}
                aria-label={t("settings.budget.categories.colorLabel", { color: c })}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={`size-8 rounded-xl flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 ${
                  c === color ? "ring-2 ring-fg" : "hover:scale-105"
                }`}
                style={{ background: c }}
              >
                {c === color && <Check className="size-4 text-black/80" />}
              </button>
            ))}
            <label className="flex items-center">
              <span className="sr-only">{t("settings.budget.categories.customColor")}</span>
              <input
                type="color"
                aria-label={t("settings.budget.categories.customColor")}
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000"}
                disabled={busy}
                onChange={(e) => setColor(e.target.value)}
                className="size-8 rounded-xl cursor-pointer disabled:opacity-40"
              />
            </label>
          </div>
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
              <Dot className="size-4 text-fg-faint" />
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
            disabled={busy}
            onChange={(e) => setHint(e.target.value)}
            rows={3}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
          />
          <p className="text-fg-faint text-xs mt-1">{t("settings.budget.categories.hintHelp")}</p>
        </Field>

        {mutation.isError && (
          <p role="alert" className="text-red text-sm">
            {t(`settings.budget.categories.${budgetErrorKey(mutation.error)}`)}
          </p>
        )}
      </div>
    </BudgetDialog>
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
