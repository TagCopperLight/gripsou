import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { BudgetDialog } from "./BudgetDialog";
import { Button } from "../Button";

type BreakPairModalProps = {
  /** How many transactions would be unlinked. 1 for a single row; for a bulk
   *  write it is the server's count, since "select all shown" can hold rows
   *  the client has never loaded. */
  count: number;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirms dissolving one or more auto-paired internal transfers.
 *
 *  Pairing is a heuristic the user is allowed to overrule (spec §4's
 *  `user > rule > pair > ai`), but the correction is destructive in a way that
 *  is easy to miss: both halves lose the link, and the untouched half keeps its
 *  `Internal transfer` category while no longer netting against anything. This
 *  says so before the write rather than leaving it to be discovered.
 */
export function BreakPairModal({ count, busy = false, onConfirm, onClose }: BreakPairModalProps) {
  const { t } = useTranslation();

  return (
    <BudgetDialog
      busy={busy}
      title={t("budget.transactions.breakPair.title")}
      onClose={onClose}
      icon={<TriangleAlert className="size-5 text-amber" />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="break-pair-confirm" onClick={onConfirm} disabled={busy}>
            {t("budget.transactions.breakPair.confirm")}
          </Button>
        </div>
      }
    >
      <p data-testid="break-pair-modal" className="text-sm text-fg-dim">
        {t("budget.transactions.breakPair.body", { count })}
      </p>
    </BudgetDialog>
  );
}
