import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./Dialog";
import { ColorSwatchGrid } from "./ColorSwatchGrid";
import { Select } from "./Select";
import { Button } from "./Button";
import { withAlpha } from "../lib/color";
import { safeBudgetColor } from "../lib/budget";
import { useAccountTypes, useUpdateAccount } from "../api/hooks";
import { accountTypeLabel, type Account } from "../api/types";

type EditAccountModalProps = {
  account: Account;
  onClose: () => void;
};

export function EditAccountModal({ account, onClose }: EditAccountModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(account.name);
  const [typeKey, setTypeKey] = useState(account.typeKey);
  const [color, setColor] = useState(account.color);

  const { data: types } = useAccountTypes();
  const update = useUpdateAccount();

  const typeOptions = (types ?? []).map((ty) => ({
    value: ty.key,
    label: accountTypeLabel(t, ty.key, ty.label),
  }));

  const trimmed = name.trim();
  const dirty =
    trimmed !== account.name || typeKey !== account.typeKey || color !== account.color;
  const busy = update.isPending;
  const canSave = dirty && trimmed !== "" && !busy;
  const previewColor = safeBudgetColor(color);

  const save = () => {
    if (!canSave) return;
    update.mutate(
      { id: account.id, name: trimmed, typeKey, color },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      large
      busy={busy}
      title={t("account.edit.title")}
      heading={
        <span data-testid="account-preview" className="truncate">
          {trimmed || t("account.edit.title")}
        </span>
      }
      onClose={onClose}
      icon={
        // The account's colour square, as on its row in the accounts list.
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: withAlpha(previewColor, 0.22) }}
        >
          <span className="size-4 rounded-[5px]" style={{ background: previewColor }} />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? t("account.edit.saving") : t("account.edit.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t("account.edit.accountName")} htmlFor="account-name">
          <input
            id="account-name"
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green disabled:opacity-60"
          />
        </Field>

        <Field label={t("account.edit.type")} htmlFor="account-type">
          <Select
            id="account-type"
            value={typeKey}
            disabled={busy}
            onChange={setTypeKey}
            options={typeOptions}
          />
        </Field>

        <Field label={t("account.edit.color")}>
          <ColorSwatchGrid
            value={color}
            onChange={setColor}
            disabled={busy}
            swatchLabel={(c) => t("account.edit.colorLabel", { color: c })}
            customLabel={t("account.edit.customColor")}
          />
        </Field>

        {update.isError && (
          <p role="alert" className="text-red text-sm">
            {t("account.edit.saveError")}
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
