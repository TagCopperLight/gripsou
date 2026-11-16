import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../ui/ConfirmDialog";

type BreakPairModalProps = {
  /** The server's count: a multi-row write can hold rows the client never loaded. */
  count: number;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Unlinking loses the link on both halves, and the untouched half keeps its `Internal transfer`
 *  category while netting against nothing, so the modal says so before the write. */
export function BreakPairModal({ count, busy = false, onConfirm, onClose }: BreakPairModalProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      tone="warning"
      title={t("budget.transactions.breakPair.title")}
      body={t("budget.transactions.breakPair.body", { count })}
      confirmLabel={t("budget.transactions.breakPair.confirm")}
      busyLabel={t("common.busy.saving")}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
