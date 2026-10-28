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

/** The saved passkeys: rename in place, delete after a confirmation asked in
 *  the row, and the way to add another. Closes itself when the last one is deleted. */
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

  const confirmDelete = async (p: Passkey) => {
    try {
      await remove.mutateAsync(p.id);
      if (passkeys.length <= 1) {
        onClose();
        return;
      }
      setDeleting(null);
    } catch {
      showError(t("passkeys.deleteFailed"));
    }
  };

  return (
    <Dialog
      large
      title={t("passkeys.title")}
      onClose={onClose}
      busy={remove.isPending}
      footer={<Button onClick={onAdd}>{t("passkeys.addPasskey")}</Button>}
    >
      {/* One card, a line between passkeys, as in the sync window. */}
      <div className="mb-2 overflow-hidden rounded-2xl bg-surface-2">
        {passkeys.map((p) => {
          const asking = deleting?.id === p.id;
          return (
            <div key={p.id} className="group flex items-center gap-3.5 border-t border-surface-3 px-3.5 py-3 first:border-t-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-dim">
                <Fingerprint className="size-4.5" strokeWidth={2} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {renaming === p.id ? (
                  // Over the name, its text where the name's was: nothing moves.
                  <input
                    autoFocus
                    aria-label={t("passkeys.nameLabel")}
                    value={draft}
                    maxLength={MAX_NAME}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
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
                    className="-mx-2.5 -my-[3.75px] h-7.5 rounded-lg bg-surface-3 px-2.5 text-[15px] text-fg outline-none ring-1 ring-inset ring-green"
                  />
                ) : (
                  <span className="truncate text-[15px] text-fg">{p.name}</span>
                )}
                <span className="truncate text-sm text-fg-faint">
                  {t("passkeys.added", { date: formatDate(p.createdAt) })}
                  {p.lastUsedAt !== null &&
                    ` · ${t("passkeys.lastUsed", { time: formatRelative(p.lastUsedAt) })}`}
                </span>
              </div>
              {asking ? (
                // Asked in the row: the list stays in view.
                <div
                  role="group"
                  aria-label={t("passkeys.deleteTitle", { name: p.name })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setDeleting(null);
                    }
                  }}
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap"
                >
                  <span className="mr-1 text-[13px] text-red">{t("passkeys.deleteAsk")}</span>
                  <Button variant="ghost" padded={false} className="px-2.5 py-1.5 text-[13px]" onClick={() => setDeleting(null)} disabled={remove.isPending}>
                    {t("common.cancel")}
                  </Button>
                  <Button variant="danger" padded={false} className="px-2.5 py-1.5 text-[13px]" onClick={() => void confirmDelete(p)} disabled={remove.isPending} autoFocus>
                    {t("passkeys.delete")}
                  </Button>
                </div>
              ) : (
                // On hover on a computer, or reached with the keyboard (not
                // just focused: the window focuses the first row's pencil when
                // it opens); always on a phone, which has no hover.
                <div className={`flex shrink-0 items-center gap-0.5 transition-opacity duration-140 has-focus-visible:opacity-100 md:group-hover:opacity-100 ${renaming === p.id ? "" : "md:opacity-0"}`}>
                  <button
                    type="button"
                    onClick={() => startRename(p)}
                    aria-label={t("passkeys.rename")}
                    className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
                  >
                    <Pencil className="size-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(null);
                      setDeleting(p);
                    }}
                    aria-label={t("passkeys.delete")}
                    className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-red"
                  >
                    <Trash2 className="size-4" strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
