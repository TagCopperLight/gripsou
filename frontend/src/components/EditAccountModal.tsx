import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { Select } from "./Select";
import { ACCOUNT_PALETTE } from "../lib/palette";
import { useAccountTypes, useUpdateAccount } from "../api/hooks";
import type { Account } from "../api/types";

type EditAccountModalProps = {
  account: Account;
  onClose: () => void;
};

export function EditAccountModal({ account, onClose }: EditAccountModalProps) {
  const [name, setName] = useState(account.name);
  const [typeKey, setTypeKey] = useState(account.typeKey);
  const [color, setColor] = useState(account.color);

  const { data: types } = useAccountTypes();
  const update = useUpdateAccount();

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const typeOptions = (types ?? []).map((t) => ({ value: t.key, label: t.label }));
  const typeLabel =
    types?.find((t) => t.key === typeKey)?.label ?? account.typeLabel;

  const dirty =
    name !== account.name || typeKey !== account.typeKey || color !== account.color;
  const valid = name.trim() !== "";
  const canSave = dirty && valid && !update.isPending;

  const save = () => {
    if (!canSave) return;
    update.mutate(
      { id: account.id, name: name.trim(), typeKey, color },
      { onSuccess: onClose },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit account"
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-semibold text-fg">Edit account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex flex-col gap-5">
          <Field label="Account name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green"
            />
          </Field>

          <Field label="Type">
            <Select value={typeKey} onChange={setTypeKey} options={typeOptions} />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={`size-8 rounded-xl flex items-center justify-center cursor-pointer transition-transform duration-140 ${
                    c === color ? "ring-2 ring-fg" : "hover:scale-105"
                  }`}
                  style={{ background: c }}
                >
                  {c === color && <Check className="size-4 text-black/80" />}
                </button>
              ))}
            </div>
          </Field>

          {/* Live preview of the account row */}
          <div className="flex items-center justify-between bg-surface-2 rounded-2xl px-4 py-3.5">
            <span className="flex items-center gap-3 min-w-0">
              <span
                className="size-3 rounded-sm shrink-0"
                style={{ background: color }}
              />
              <span className="text-fg font-semibold text-[15px] truncate">
                {name.trim() || "Account name"}
              </span>
            </span>
            <span className="text-fg-faint text-sm shrink-0 mr-2">{typeLabel}</span>
          </div>

          {update.isError && (
            <p className="text-red text-sm">
              Could not save changes. Please try again.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-fg-dim hover:text-fg font-medium cursor-pointer transition-colors duration-140"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-4 py-2.5 rounded-xl bg-green text-black font-semibold cursor-pointer transition-opacity duration-140 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-fg-faint text-sm">{label}</span>
      {children}
    </div>
  );
}
