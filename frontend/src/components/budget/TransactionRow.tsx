import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";

import { TransactionAvatar } from "./TransactionAvatar";
import { CategoryChip } from "./CategoryChip";
import { TagCell } from "./TagCell";
import { Checkbox } from "../Checkbox";
import { Money } from "../Money";
import { formatDate } from "../../lib/date";
import { formatQuantity } from "../../lib/money";
import { FALLBACK_COLOR, categoryOfTransaction } from "../../lib/budget";
import { COL_PAD } from "./transactionsGrid";
import type { Transaction } from "../../api/types";

type TransactionRowProps = {
  tx: Transaction;
  showChecked: boolean;
  selected: boolean;
  /** True while anything at all is selected: every avatar becomes a checkbox. */
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  /** The clicked control comes along: the chooser is a popover anchored to it. */
  onOpenCategory: (tx: Transaction, anchor: HTMLElement) => void;
  onOpenTags: (tx: Transaction, anchor: HTMLElement) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** Everything the row's cells share, applied from the `<tr>`.
 *
 *  The background lives on the cells, not on the `<tr>`: only a cell can round
 *  a corner, so the first and last one carry the row's rounded ends.
 *
 *  Each cell is a grid item on the table's tracks (see `transactionsGrid`), so
 *  it stretches to the row's height — `flex items-center` is what centres the
 *  content inside it now that no table layout does.
 *
 *  Vertical geometry, top to bottom: a 1px transparent top border, the
 *  rectangle (9px of padding either side of the content), then a 2px
 *  transparent bottom border. `bg-clip-padding` keeps the hover fill off those
 *  borders, so each rectangle stops 1px short of its neighbours; `::after`
 *  draws the separator into the middle of the resulting 3px band — 1px gap,
 *  1px rule, 1px gap. The 2px that band needed came out of the padding
 *  (10px → 9px), so the row's total height is exactly what it was.
 *
 *  Horizontally the rule is flush with the text, not with the row: the end
 *  cells pull it in by their own edge padding, so it runs from the T of
 *  TRANSACTION to the last digit of the amount. The hover rectangle still
 *  goes full-bleed underneath — only the separator is inset.
 */
const CELL = [
  "[&>td]:flex [&>td]:items-center [&>td]:min-w-0",
  "[&>td]:relative [&>td]:border-y [&>td]:border-b-2 [&>td]:border-transparent [&>td]:bg-clip-padding",
  "[&>td]:after:content-[''] [&>td]:after:absolute [&>td]:after:inset-x-0",
  "[&>td]:after:-top-0.5 [&>td]:after:h-px [&>td]:after:bg-surface-2",
  "[&>td]:transition-colors [&>td]:duration-140",
  "[&>td:first-child]:after:left-3 [&>td:last-child]:after:right-3",
  "[&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl",
].join(" ");

/** Memoised: a ledger can hold thousands of mounted rows, and the page above
 *  re-renders on every search keystroke and selection click. The table hands
 *  each row plain values and stable callbacks, so only a row whose own data or
 *  selection changed renders again. */
export const TransactionRow = memo(function TransactionRow({
  tx, showChecked, selected, anySelected,
  onToggleSelect, onOpenCategory, onOpenTags, onToggleChecked,
}: TransactionRowProps) {
  const { t } = useTranslation();
  const isLot = tx.source === "lot";
  /** Every row's controls would otherwise share one name ("Select row"), so
   *  each carries the row's own text, the way the settings tables do. */
  const name = (isLot ? tx.ticker : tx.description) ?? "";
  const named = (label: string) => (name ? `${label}: ${name}` : label);
  const LotIcon = tx.type === "sell" ? TrendingDown : TrendingUp;
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
      className={`col-span-full grid grid-cols-subgrid text-sm ${CELL} group ${
        selected ? "[&>td]:bg-green/12 hover:[&>td]:bg-green/18" : "hover:[&>td]:bg-hover"
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
            <p data-testid="tx-description" className="truncate uppercase text-fg">
              {isLot ? tx.ticker ?? "" : tx.description ?? ""}
            </p>
            {isLot && (
              <p data-testid="tx-lot-line" className="flex items-center gap-1 text-xs text-fg-faint">
                <LotIcon className="size-3" />
                {tx.ticker}
                {" · "}
                {formatQuantity(tx.quantity ?? "0")} @ {tx.unitPrice}
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
              <p data-testid="tx-orphan-note" className="flex items-center gap-1 text-xs text-amber">
                <TriangleAlert className="size-3 shrink-0" />
                {t("budget.transactions.orphanTransfer")}
              </p>
            )}
          </div>
        </div>
      </td>

      <td role="cell" className={`py-2.25 whitespace-nowrap text-fg-dim ${COL_PAD.date}`}>
        <span className={dim}>{formatDate(tx.t)}</span>
      </td>

      <td role="cell" className={`py-2.25 ${COL_PAD.account}`}>
        <span className={`flex min-w-0 items-center gap-2 ${dim}`}>
          <span
            className="inline-block size-3 rounded"
            style={{ backgroundColor: tx.accountColor ?? FALLBACK_COLOR }}
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
          <Money value={tx.amount} currency={tx.currency} signed className="text-fg" />
        </span>
      </td>
    </tr>
  );
});
