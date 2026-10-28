import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, TriangleAlert } from "lucide-react";

import { TransactionAvatar } from "./TransactionAvatar";
import { CategoryChip } from "./CategoryChip";
import { TagCell } from "./TagCell";
import { Checkbox } from "../Checkbox";
import { Money } from "../Money";
import { MoneyHint } from "../MoneyHint";
import { MaskedMoney } from "../PrivateMoney";
import { getPrefs } from "../../lib/prefs";
import { formatDay } from "../../lib/date";
import { formatQuantity } from "../../lib/money";
import { categoryOfTransaction } from "../../lib/budget";
import { COL_PAD } from "./transactionsGrid";
import { ROW_CELLS, ROW_HOVER } from "../gridTable";
import type { Transaction } from "../../api/types";

type TransactionRowProps = {
  tx: Transaction;
  showChecked: boolean;
  /** Private mode: the amount hidden (the title's eye reveals it). */
  masked?: boolean;
  selected: boolean;
  /** True while anything at all is selected: every avatar becomes a checkbox. */
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  /** The clicked control comes along: the chooser is a popover anchored to it. */
  onOpenCategory: (tx: Transaction, anchor: HTMLElement) => void;
  onOpenTags: (tx: Transaction, anchor: HTMLElement) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** Memoised: a ledger can hold thousands of mounted rows, and the page above
 *  re-renders on every search keystroke and selection click. The table hands
 *  each row plain values and stable callbacks, so only a row whose own data or
 *  selection changed renders again. */
export const TransactionRow = memo(function TransactionRow({
  tx, showChecked, masked = false, selected, anySelected,
  onToggleSelect, onOpenCategory, onOpenTags, onToggleChecked,
}: TransactionRowProps) {
  const { t } = useTranslation();
  const isLot = tx.source === "lot";
  /** Every row's controls would otherwise share one name ("Select row"), so
   *  each carries the row's own text, the way the settings tables do. */
  const name = (isLot ? tx.ticker : tx.description) ?? "";
  const named = (label: string) => (name ? `${label}: ${name}` : label);
  /** A paired transfer is background noise, so it reads dimmed — but only its
   *  content. Opacity on the `<tr>` or on a `<td>` would drain the row's own
   *  background with it (a child cannot undo an ancestor's opacity), washing
   *  out the hover rectangle and the green of a selection. The avatar, the
   *  category chip and the tags are left alone entirely: those carry meaning
   *  in their colour. */
  const dim = tx.isTransfer ? "opacity-60" : "";

  return (
    <tr
      data-testid="tx-row"
      role="row"
      className={`text-sm ${ROW_CELLS} group ${
        selected ? "[&>td]:bg-green/12 hover:[&>td]:bg-green/18" : ROW_HOVER
      }`}
    >
      <td role="cell" className={`py-2.25 ${COL_PAD.transaction}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* A lot is an investment record, not a budget item: the server's
              assignment/bulk endpoints touch only the `transaction` table, so
              a lot row can never actually be selected or checked. It gets no control at all here — not even a disabled
              one — consistent with its category and tag cells below. */}
          {isLot ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center">
              <TransactionAvatar tx={tx} />
            </span>
          ) : (
            // Hovering reveals the checkbox; once anything is selected every row
            // shows one, so the selected set is readable at a glance.
            // Both layers stay in the DOM and are switched with opacity, not
            // `display`/`hidden` — a keyboard-only user can still Tab to and
            // focus the checkbox even on the very first row, before anything
            // is selected (it was previously display:none and unreachable).
            // The focus condition is `:focus-visible`, not plain focus: a
            // mouse click leaves the checkbox focused, and plain focus kept
            // the row stuck showing an empty checkbox after the pointer moved
            // away — a click does not match `:focus-visible`, a Tab does.
            <span className="relative inline-flex size-8 shrink-0 items-center justify-center">
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
            {/* Cut to one line; the whole text on hover. */}
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
            {/* The pair was dissolved when someone recategorised the other
                half, leaving this one reading as a transfer while netting
                against nothing. Amber, not faint: unlike the note above it
                asks for a correction rather than explaining a settled state. */}
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
        {/* A lot is an investment record, not a budget item: no chip, and no
            way to assign one. */}
        {isLot ? null : (
          <button
            type="button"
            onClick={(e) => onOpenCategory(tx, e.currentTarget)}
            className="min-w-0 cursor-pointer"
            aria-label={named(t("budget.transactions.setCategory"))}
            aria-haspopup="dialog"
          >
            <CategoryChip category={categoryOfTransaction(tx)} needsReview={tx.needsReview} />
          </button>
        )}
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

      <td role="cell" className={`justify-end whitespace-nowrap py-2.25 ${COL_PAD.amount}`}>
        {/* Denominated in the ACCOUNT's own currency, never the reporting one. */}
        <span data-testid="tx-amount" className={dim}>
          <MoneyHint hint={!masked && tx.currency !== getPrefs().currency && tx.amountReporting !== null
            ? <Money value={tx.amountReporting} signed /> : null}>
            <MaskedMoney masked={masked} value={tx.amount} currency={tx.currency} signed className="text-fg" />
          </MoneyHint>
        </span>
      </td>
    </tr>
  );
});
