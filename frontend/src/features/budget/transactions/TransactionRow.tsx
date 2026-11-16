import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, TriangleAlert } from "lucide-react";

import { TransactionAvatar } from "../TransactionAvatar";
import { CategoryChip } from "../CategoryChip";
import { TagCell } from "./TagCell";
import { Checkbox } from "../../../ui/Checkbox";
import { MoneyHint } from "../../../ui/MoneyHint";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { formatDay } from "../../../lib/date";
import { formatQuantity } from "../../../lib/money";
import { categoryOfTransaction } from "../../../lib/budget";
import { COL_PAD } from "./transactionsGrid";
import { ROW_CELLS, ROW_HOVER } from "../../../ui/gridTable";
import type { Transaction } from "../../../api/wire";

type TransactionRowProps = {
  tx: Transaction;
  showChecked: boolean;
  /** Category and date move into the description and amount cells, their columns being dropped. */
  phone: boolean;
  masked?: boolean;
  selected: boolean;
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  /** The clicked control comes along: the chooser is a popover anchored to it. */
  onOpenCategory: (tx: Transaction, anchor: HTMLElement) => void;
  onOpenTags: (tx: Transaction, anchor: HTMLElement) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** Memoised: a ledger mounts thousands of rows and the page re-renders on every keystroke and selection click. */
export const TransactionRow = memo(function TransactionRow({
  tx, showChecked, phone, masked = false, selected, anySelected,
  onToggleSelect, onOpenCategory, onOpenTags, onToggleChecked,
}: TransactionRowProps) {
  const { t } = useTranslation();
  const isLot = tx.source === "lot";
  /** Row text, so each row's controls get a distinct accessible name. */
  const name = (isLot ? tx.ticker : tx.description) ?? "";
  const named = (label: string) => (name ? `${label}: ${name}` : label);
  /** Dims only the content: opacity on the `<tr>` or a `<td>` would also drain the row background
   *  (hover, selection). Avatar, category chip and tags stay undimmed: their colour carries meaning. */
  const dim = tx.isTransfer ? "opacity-60" : "";
  const categoryButton = (className: string, look?: "text") => (
    <button
      type="button"
      onClick={(e) => onOpenCategory(tx, e.currentTarget)}
      className={`cursor-pointer ${className}`}
      aria-label={named(t("budget.transactions.setCategory"))}
      aria-haspopup="dialog"
    >
      <CategoryChip category={categoryOfTransaction(tx)} needsReview={tx.needsReview} look={look} />
    </button>
  );

  return (
    <tr
      data-testid="tx-row"
      role="row"
      className={`text-sm ${ROW_CELLS} group ${
        selected ? "[&>td]:bg-green/12 hover:[&>td]:bg-green/18" : ROW_HOVER
      }`}
    >
      <td role="cell" className={`py-2.25 ${COL_PAD.transaction}`}>
        {/* A phone puts the category under the description, in a second grid row. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:gap-y-0">
          {/* Lots are not selectable: the server's bulk endpoints touch only `transaction`. */}
          {isLot ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center max-md:row-span-2">
              <TransactionAvatar tx={tx} />
            </span>
          ) : (
            // Both layers stay in the DOM and switch with opacity, not `display`, so keyboard users can Tab to the checkbox.
            // `:focus-visible`, not focus: a click leaves the checkbox focused and would keep it showing.
            <span className="relative inline-flex size-8 shrink-0 items-center justify-center max-md:row-span-2">
              {!anySelected && (
                <span className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity group-hover:opacity-0 group-has-[:focus-visible]:opacity-0">
                  <TransactionAvatar tx={tx} />
                </span>
              )}
              <Checkbox
                data-testid="tx-select"
                label={named(t("budget.transactions.selectRow"))}
                checked={selected}
                onChange={() => onToggleSelect(tx.id)}
                className={`absolute inset-0 m-auto transition-opacity ${
                  anySelected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
                }`}
              />
            </span>
          )}
          <div className={`min-w-0 flex-1 ${dim}`}>
            <p data-testid="tx-description" title={name} className="truncate uppercase text-fg">
              {name}
            </p>
            {isLot && (
              <p data-testid="tx-lot-line" className="truncate text-xs text-fg-faint">
                {t(tx.type === "sell" ? "budget.transactions.lotSell" : "budget.transactions.lotBuy")}
                {" · "}
                {formatQuantity(tx.quantity ?? "0")} ×{" "}
                <MaskedMoney masked={masked} value={tx.unitPrice ?? "0"} currency={tx.currency} className="text-xs" />
              </p>
            )}
            {tx.isTransfer && (
              <p data-testid="tx-transfer-note" className="flex items-center gap-1 text-xs text-fg-faint">
                <ArrowUpDown className="size-3" />
                {t("budget.transactions.autoPaired")}
              </p>
            )}
            {/* Amber: unlike the note above, it asks for a correction. */}
            {tx.isOrphanTransfer && (
              <p
                data-testid="tx-orphan-note"
                title={t("budget.transactions.orphanTransferHint")}
                className="flex items-center gap-1 text-xs text-amber"
              >
                <TriangleAlert className="size-3 shrink-0" />
                <span className="truncate">{t("budget.transactions.orphanTransfer")}</span>
              </p>
            )}
          </div>
          {phone && !isLot && categoryButton("col-start-2 max-w-full justify-self-start", "text")}
        </div>
      </td>

      <td role="cell" className={`py-2.25 whitespace-nowrap text-fg-dim ${COL_PAD.date}`}>
        <span className={dim}>{formatDay(tx.t)}</span>
      </td>

      <td role="cell" className={`py-2.25 ${COL_PAD.account}`}>
        <span className={`flex min-w-0 items-center gap-2 ${dim}`}>
          <span
            className="inline-block size-3 rounded"
            style={{ backgroundColor: tx.accountColor }}
          />
          <span className="truncate text-fg-dim">{tx.accountName}</span>
        </span>
      </td>

      <td role="cell" className={`py-2.25 ${COL_PAD.category}`}>
        {isLot ? null : categoryButton("min-w-0")}
      </td>

      <td role="cell" data-testid="tx-tags" className={`py-2.25 ${COL_PAD.tags}`}>
        {isLot ? null : (
          <TagCell
            tags={tx.tags}
            label={named(t("budget.transactions.addTags"))}
            onOpen={(anchor) => onOpenTags(tx, anchor)}
          />
        )}
      </td>

      {showChecked && (
        <td role="cell" className={`justify-center py-2.25 ${COL_PAD.checked}`}>
          {isLot ? null : (
            <Checkbox
              data-testid="tx-checked"
              tone="soft"
              className={dim}
              label={named(t("budget.transactions.checked"))}
              checked={tx.checked}
              onChange={() => onToggleChecked(tx)}
            />
          )}
        </td>
      )}

      <td role="cell" className={`justify-end whitespace-nowrap py-2.25 max-md:flex-col max-md:items-end max-md:justify-center ${COL_PAD.amount}`}>
        {/* Denominated in the ACCOUNT's own currency, never the reporting one. */}
        <span data-testid="tx-amount" className={dim}>
          <MoneyHint currency={tx.currency} converted={masked ? null : tx.amountReporting} signed>
            <MaskedMoney masked={masked} value={tx.amount} currency={tx.currency} signed className="text-fg" />
          </MoneyHint>
        </span>
        {phone && <span className={`text-xs text-fg-faint ${dim}`}>{formatDay(tx.t)}</span>}
      </td>
    </tr>
  );
});
