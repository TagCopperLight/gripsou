import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Plus, TriangleAlert } from "lucide-react";

import { Dialog } from "../../../ui/Dialog";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { Money } from "../../../ui/Money";
import { Toggle } from "../../../ui/Toggle";
import { ColorSquare } from "../../../ui/ColorSquare";
import { TransactionAvatar } from "../TransactionAvatar";
import { CategoryChip } from "../CategoryChip";
import { TagChip } from "../TagChip";
import { usePrefs } from "../../../auth/context";
import { formatDay } from "../../../lib/date";
import { formatQuantity } from "../../../lib/money";
import { categoryOfTransaction } from "../../../lib/budget";
import type { Transaction } from "../../../api/wire";

type TransactionSheetProps = {
  tx: Transaction;
  showChecked: boolean;
  masked: boolean;
  onOpenCategory: (tx: Transaction, anchor: HTMLElement) => void;
  onOpenTags: (tx: Transaction, anchor: HTMLElement) => void;
  onToggleChecked: (tx: Transaction) => void;
  onClose: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-fg-faint">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

/** A phone's row has room for the name, category and amount only: the rest is here. */
export function TransactionSheet({
  tx, showChecked, masked, onOpenCategory, onOpenTags, onToggleChecked, onClose,
}: TransactionSheetProps) {
  const { t } = useTranslation();
  const reader = usePrefs().currency;
  const isLot = tx.source === "lot";
  const name = (isLot ? tx.ticker : tx.description) ?? "";
  const converted = !masked && tx.currency !== reader ? tx.amountReporting : null;

  return (
    <Dialog
      title={name}
      heading={<span className="break-words uppercase">{name}</span>}
      icon={<TransactionAvatar tx={tx} />}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1 pb-3">
        <MaskedMoney masked={masked} value={tx.amount} currency={tx.currency} signed className="text-2xl font-semibold tracking-tight text-fg" />
        {converted !== null && <Money value={converted} signed className="text-sm text-fg-faint" />}
        {isLot && (
          <p className="text-sm text-fg-dim">
            {t(tx.type === "sell" ? "budget.transactions.lotSell" : "budget.transactions.lotBuy")}
            {" · "}
            {formatQuantity(tx.quantity ?? "0")} ×{" "}
            <MaskedMoney masked={masked} value={tx.unitPrice ?? "0"} currency={tx.currency} />
          </p>
        )}
        {tx.isTransfer && (
          <p className="flex items-center gap-1.5 text-sm text-fg-faint">
            <ArrowUpDown className="size-3.5 shrink-0" />
            {t("budget.transactions.autoPaired")}
          </p>
        )}
        {tx.isOrphanTransfer && (
          <div className="mt-1 flex gap-2 rounded-xl bg-amber-soft p-3 text-sm text-amber">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">{t("budget.transactions.orphanTransfer")}</span>
              {". "}
              {t("budget.transactions.orphanTransferHint")}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col divide-y divide-surface-2 text-sm">
        <Row label={t("budget.transactions.columns.date")}>
          <span className="font-mono text-fg">{formatDay(tx.t)}</span>
        </Row>
        <Row label={t("budget.transactions.columns.account")}>
          <span className="flex min-w-0 items-center gap-2 text-fg">
            <ColorSquare color={tx.accountColor} />
            <span className="truncate">{tx.accountName}</span>
          </span>
        </Row>
        {!isLot && (
          <>
            <Row label={t("budget.transactions.columns.category")}>
              <button
                type="button"
                onClick={(e) => onOpenCategory(tx, e.currentTarget)}
                aria-label={t("budget.transactions.setCategory")}
                aria-haspopup="dialog"
                className="min-w-0 cursor-pointer"
              >
                <CategoryChip category={categoryOfTransaction(tx)} needsReview={tx.needsReview} />
              </button>
            </Row>
            <Row label={t("budget.transactions.columns.tags")}>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {tx.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
                <button
                  type="button"
                  onClick={(e) => onOpenTags(tx, e.currentTarget)}
                  aria-haspopup="dialog"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs text-fg-dim"
                >
                  <Plus className="size-3.5" />
                  {t("budget.transactions.addTags")}
                </button>
              </div>
            </Row>
            {showChecked && (
              <Row label={t("budget.transactions.checked")}>
                <Toggle
                  checked={tx.checked}
                  onChange={() => onToggleChecked(tx)}
                  aria-label={t("budget.transactions.checked")}
                />
              </Row>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
