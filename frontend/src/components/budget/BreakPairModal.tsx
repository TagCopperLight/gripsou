import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../ConfirmDialog";

type BreakPairModalProps = {
  /** How many transactions would be unlinked — the server's count, since a
   *  multi-row write can hold rows the client has never loaded. */
  count: number;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirms dissolving one or more auto-paired internal transfers.
 *
 *  Pairing is a heuristic the user is allowed to overrule, but the correction
 *  is destructive in a way that is easy to miss: both halves lose the link, and
 *  the untouched half keeps its `Internal transfer` category while no longer
 *  netting against anything. This says so before the write rather than leaving
 *  it to be discovered.
 */
export function BreakPairModal({ count, busy = false, onConfirm, onClose }: BreakPairModalProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      tone="warning"
      title={t("budget.transactions.breakPair.title")}
      body={t("budget.transactions.breakPair.body", { count })}
      confirmLabel={t("budget.transactions.breakPair.confirm")}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
      data-testid="break-pair-modal"
      confirmTestId="break-pair-confirm"
    />
  );
}
