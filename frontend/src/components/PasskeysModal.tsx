import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";
import { Fingerprint, Pencil, Trash2 } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { useDeletePasskey, useMfaStatus, useRenamePasskey } from "../api/hooks";
import type { Passkey } from "../api/types";
import { formatDate, formatRelative } from "../lib/date";

const MAX_NAME = 64;

/** The saved passkeys: rename in place, delete after a confirmation, and the
 *  way to add another. Closes itself when the last one is deleted. */
export function PasskeysModal({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { data: status } = useMfaStatus();
  const passkeys = status?.passkeys ?? [];
  const rename = useRenamePasskey();
  const remove = useDeletePasskey();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<Passkey | null>(null);

  const startRename = (p: Passkey) => {
    setDraft(p.name);
    setRenaming(p.id);
  };

  const saveRename = async (p: Passkey) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === p.name) return;
    try {
      await rename.mutateAsync({ id: p.id, name });
    } catch {
      showError(t("passkeys.renameFailed"));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      if (passkeys.length <= 1) {
        onClose();
        return;
      }
      setDeleting(null);
    } catch {
      showError(t("passkeys.deleteFailed"));
    }
  };

  if (deleting) {
    return (
      <Dialog
        key="delete"
        title={t("passkeys.deleteTitle", { name: deleting.name })}
        onClose={onClose}
        busy={remove.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={remove.isPending}>
              {t("passkeys.delete")}
            </Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      key="list"
      title={t("passkeys.title")}
      onClose={onClose}
      footer={<Button onClick={onAdd}>{t("passkeys.addPasskey")}</Button>}
    >
      <div className="flex flex-col gap-3 pb-2">
        {passkeys.map((p) => (
          <div key={p.id} className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-dim">
              <Fingerprint className="size-4.5" strokeWidth={2} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {renaming === p.id ? (
                <input
                  autoFocus
                  aria-label={t("passkeys.nameLabel")}
                  value={draft}
                  maxLength={MAX_NAME}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void saveRename(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      // Cancels the rename only, not the whole window.
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                  className="-mx-2 -my-1 rounded-lg bg-surface-3 px-2 py-1 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
                />
              ) : (
                <span className="truncate text-[15px] text-fg">{p.name}</span>
              )}
              <span className="text-sm text-fg-faint">
                {t("passkeys.added", { date: formatDate(p.createdAt) })}
                {p.lastUsedAt !== null &&
                  ` · ${t("passkeys.lastUsed", { time: formatRelative(p.lastUsedAt) })}`}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => startRename(p)}
                aria-label={t("passkeys.rename")}
                className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
              >
                <Pencil className="size-4.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleting(p);
                }}
                aria-label={t("passkeys.delete")}
                className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-red"
              >
                <Trash2 className="size-4.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
