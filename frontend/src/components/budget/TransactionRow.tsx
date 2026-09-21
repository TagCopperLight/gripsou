import { useTranslation } from "react-i18next";
import { Plus, Repeat, TrendingDown, TrendingUp } from "lucide-react";

import { TransactionAvatar } from "./TransactionAvatar";
import { CategoryChip } from "./CategoryChip";
import { TagChip } from "./TagChip";
import { Money } from "../Money";
import { formatDate } from "../../lib/date";
import { formatQuantity } from "../../lib/money";
import type { BudgetCategory } from "../../api/budget";
import type { Transaction } from "../../api/types";

type TransactionRowProps = {
  tx: Transaction;
  showChecked: boolean;
  selected: boolean;
  /** True while anything at all is selected: every avatar becomes a checkbox. */
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenCategory: (tx: Transaction) => void;
  onOpenTags: (tx: Transaction) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** The row's own category, rebuilt from the flat fields the list endpoint
 *  sends, so `CategoryChip` can be reused verbatim from phase 2. */
function categoryOf(tx: Transaction): BudgetCategory | null {
  if (!tx.categoryId) return null;
  return {
    id: tx.categoryId,
    name: tx.categoryName ?? "",
    defaultKey: tx.categoryDefaultKey,
    color: tx.categoryColor ?? "",
    icon: tx.categoryIcon,
    hint: null,
    kind: tx.categoryKind ?? "expense",
    systemKey: null,
    archived: false,
    txCount: 0,
  };
}

export function TransactionRow({
  tx, showChecked, selected, anySelected,
  onToggleSelect, onOpenCategory, onOpenTags, onToggleChecked,
}: TransactionRowProps) {
  const { t } = useTranslation();
  const isLot = tx.source === "lot";
  const LotIcon = tx.type === "sell" ? TrendingDown : TrendingUp;

  return (
    <tr
      data-testid="tx-row"
      className={`group border-t border-surface-2 text-sm ${
        selected ? "bg-green/12" : "hover:bg-hover"
      } ${tx.isTransfer ? "opacity-60" : ""}`}
    >
      <td className="py-2 pl-2">
        <div className="flex items-center gap-3">
          {/* A lot is an investment record, not a budget item: the server's
              assignment/bulk endpoints touch only the `transaction` table, so
              a lot row can never actually be selected or checked (spec
              §4.4). It gets no control at all here — not even a disabled
              one — consistent with its category and tag cells below. */}
          {isLot ? (
            <span className="inline-flex size-8 items-center justify-center">
              <TransactionAvatar tx={tx} />
            </span>
          ) : (
            // Hovering reveals the checkbox; once anything is selected every row
            // shows one, so the selected set is readable at a glance (§2.3).
            // Both layers stay in the DOM and are switched with opacity, not
            // `display`/`hidden` — a keyboard-only user can still Tab to and
            // focus the checkbox even on the very first row, before anything
            // is selected (it was previously display:none and unreachable).
            <span className="relative inline-flex size-8 items-center justify-center">
              {!anySelected && (
                <span className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  <TransactionAvatar tx={tx} />
                </span>
              )}
              <input
                type="checkbox"
                data-testid="tx-select"
                aria-label={t("budget.transactions.selectRow")}
                checked={selected}
                onChange={() => onToggleSelect(tx.id)}
                className={`absolute inset-0 m-auto size-4 cursor-pointer accent-green transition-opacity ${
                  anySelected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                }`}
              />
            </span>
          )}
          <div className="min-w-0">
            <p data-testid="tx-description" className="truncate uppercase text-fg">
              {isLot ? (tx.ticker ?? "") : (tx.description ?? "")}
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
                <Repeat className="size-3" />
                {t("budget.transactions.autoPaired")}
              </p>
            )}
          </div>
        </div>
      </td>

      <td className="py-2 whitespace-nowrap text-fg-dim">{formatDate(tx.t)}</td>

      <td className="py-2">
        <span className="flex items-center gap-2">
          <span
            className="inline-block size-3 rounded"
            style={{ backgroundColor: tx.accountColor ?? "#aeaaa7" }}
          />
          <span className="truncate text-fg-dim">{tx.accountName}</span>
        </span>
      </td>

      <td className="py-2">
        {/* A lot is an investment record, not a budget item: no chip, and no
            way to assign one (spec §5.2). */}
        {isLot ? null : (
          <button
            type="button"
            onClick={() => onOpenCategory(tx)}
            className="cursor-pointer"
            aria-label={t("budget.transactions.setCategory")}
          >
            <CategoryChip category={categoryOf(tx)} needsReview={tx.needsReview} />
          </button>
        )}
      </td>

      <td className="py-2" data-testid="tx-tags">
        {isLot ? null : (
          <span className="flex flex-wrap items-center gap-1">
            {tx.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
            {/* Always mounted (for non-lot rows) and focusable — opacity, not
                `display`, drives visibility so a keyboard-only user can Tab to
                it and reveal it with its own focus, not just row hover. */}
            <button
              type="button"
              data-testid="tx-add-tag"
              onClick={() => onOpenTags(tx)}
              aria-label={t("budget.transactions.addTags")}
              className="cursor-pointer rounded-md p-1 text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            >
              <Plus className="size-3.5" />
            </button>
          </span>
        )}
      </td>

      {showChecked && (
        <td className="py-2 text-center">
          {isLot ? null : (
            <input
              type="checkbox"
              data-testid="tx-checked"
              aria-label={t("budget.transactions.checked")}
              checked={tx.checked}
              onChange={() => onToggleChecked(tx)}
              className="size-4 cursor-pointer accent-green"
            />
          )}
        </td>
      )}

      <td className="py-2 pr-2 text-right">
        {/* Denominated in the ACCOUNT's own currency, never the reporting one. */}
        <span data-testid="tx-amount">
          <Money value={tx.amount} currency={tx.currency} signed className="text-fg" />
        </span>
      </td>
    </tr>
  );
}
