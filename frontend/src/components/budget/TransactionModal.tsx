import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BudgetDialog } from "./BudgetDialog";
import { TransactionAvatar } from "./TransactionAvatar";
import { Button } from "../Button";
import { useMerchantLogoPreview, usePatchTransaction, useSetMerchant } from "../../api/budget";
import { ApiError } from "../../api/client";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Transaction } from "../../api/types";

type DomainErrorKey = "invalidDomain" | "noIdentity" | "saveFailed";
type NoteErrorKey = "noteSaveFailed";

/** Two independent corrections, saved together:
 *  - the website: one per description (spec §7) — the memo is keyed on the
 *    normalised wording, so saving it here fixes every row that shares it.
 *  - the note: free text that belongs to THIS transaction alone.
 *  The preview is the avatar itself, fed the would-be domain. */
export function TransactionModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { t } = useTranslation();
  const saveMerchant = useSetMerchant();
  const saveNote = usePatchTransaction();

  const [domain, setDomain] = useState(tx.merchantDomain ?? "");
  // The last value successfully saved for each field, so a retry after a
  // partial failure only re-sends the part that didn't make it.
  const [savedDomain, setSavedDomain] = useState(tx.merchantDomain ?? "");
  const [domainError, setDomainError] = useState<DomainErrorKey | null>(null);

  const [note, setNote] = useState(tx.note ?? "");
  const [savedNote, setSavedNote] = useState(tx.note ?? "");
  const [noteError, setNoteError] = useState<NoteErrorKey | null>(null);

  const d = domain.trim().toLowerCase();
  // Unchanged from the row's current domain: reuse its logo URL as-is — it
  // may carry a Brandfetch client-id query string a freshly-built preview
  // wouldn't have — rather than firing a request for what we already know.
  const unchanged = Boolean(d) && d === tx.merchantDomain;
  const debouncedDomain = useDebouncedValue(d, 300);
  const previewQuery = useMerchantLogoPreview(unchanged ? "" : debouncedDomain);
  // Empty domain, or a pending/failed preview: no logo (the avatar falls
  // back to the category icon). A stale in-flight preview for a domain the
  // user has since changed is not shown either — only the debounced value's
  // own result is trusted, and react-query keys it by that value already.
  const previewLogo = !d
    ? null
    : unchanged
      ? tx.merchantLogoUrl
      : (previewQuery.data?.logoUrl ?? null);
  const preview: Transaction = { ...tx, merchantLogoUrl: previewLogo };

  const busy = saveMerchant.isPending || saveNote.isPending;

  const submit = async () => {
    const nextDomain = d;
    const nextNote = note.trim();
    const needDomain = nextDomain !== savedDomain;
    const needNote = nextNote !== savedNote;

    if (!needDomain && !needNote) {
      onClose();
      return;
    }

    let domainOk = !needDomain;
    let noteOk = !needNote;

    if (needDomain) {
      setDomainError(null);
      try {
        await saveMerchant.mutateAsync({ transactionId: tx.id, domain: nextDomain || null });
        setSavedDomain(nextDomain);
        domainOk = true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) setDomainError("invalidDomain");
        else if (err instanceof ApiError && err.status === 422) setDomainError("noIdentity");
        else setDomainError("saveFailed");
      }
    }

    if (needNote) {
      setNoteError(null);
      try {
        await saveNote.mutateAsync({ id: tx.id, body: { note: nextNote } });
        setSavedNote(nextNote);
        noteOk = true;
      } catch {
        setNoteError("noteSaveFailed");
      }
    }

    if (domainOk && noteOk) onClose();
  };

  return (
    <BudgetDialog
      title={t("budget.merchant.title")}
      heading={
        <span className="flex items-center gap-3">
          <TransactionAvatar key={preview.merchantLogoUrl ?? "none"} tx={preview} />
          <span className="truncate uppercase">{tx.description}</span>
        </span>
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("budget.merchant.cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{t("budget.merchant.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="merchant-domain" className="text-sm text-fg">{t("budget.merchant.domain")}</label>
          <input id="merchant-domain" className="rounded-xl bg-surface-2 px-3.5 py-2 font-mono text-sm text-fg" value={domain}
            onChange={(e) => setDomain(e.target.value)} />
          <span className="text-xs text-fg-faint">{t("budget.merchant.domainHint")}</span>
          {domainError && <p className="text-sm text-red">{t(`budget.merchant.${domainError}`)}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="transaction-note" className="text-sm text-fg">{t("budget.merchant.note")}</label>
          <textarea id="transaction-note" rows={3} maxLength={2000}
            className="rounded-xl bg-surface-2 px-3.5 py-2 text-sm text-fg" value={note}
            onChange={(e) => setNote(e.target.value)} />
          {noteError && <p className="text-sm text-red">{t(`budget.merchant.${noteError}`)}</p>}
        </div>
      </div>
    </BudgetDialog>
  );
}
