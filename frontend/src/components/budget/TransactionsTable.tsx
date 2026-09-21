import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, Inbox } from "lucide-react";

import { TransactionRow } from "./TransactionRow";
import { CardState } from "../CardState";
import { Button } from "../Button";
import type { Transaction, TransactionCounts } from "../../api/types";

type TransactionsTableProps = {
  rows: Transaction[];
  showChecked: boolean;
  /** undefined while the counts are still loading. */
  counts?: TransactionCounts;
  filtered: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  isSelected: (id: string) => boolean;
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenCategory: (tx: Transaction) => void;
  onOpenTags: (tx: Transaction) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** Fixed widths so nothing shifts when a filter changes the content (§2.3).
 *  Overflow is handled inside each cell, never by the column. Two sets so the
 *  ✓ column's 6% comes out of "transaction" rather than being added on top —
 *  both must total 100%, or toggling the preference squeezes every column. */
const WIDTHS = ["w-[34%]", "w-[10%]", "w-[16%]", "w-[16%]", "w-[14%]", "w-[10%]"];
const WIDTHS_CHECKED = ["w-[28%]", "w-[10%]", "w-[16%]", "w-[16%]", "w-[14%]", "w-[10%]"];

export function TransactionsTable(props: TransactionsTableProps) {
  const { t } = useTranslation();
  const {
    rows, showChecked, counts, filtered, loading, error, onRetry,
    hasNextPage, fetchingNextPage, onLoadMore, onClearFilters,
  } = props;
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll (§2.1). The button below stays as the accessible fallback
  // and is what the tests drive, since jsdom has no IntersectionObserver.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !fetchingNextPage) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, fetchingNextPage, onLoadMore]);

  if (loading || error) {
    return (
      <div data-testid="table-state">
        <CardState variant={error ? "error" : "loading"} onRetry={onRetry} className="h-40" />
      </div>
    );
  }

  if (rows.length === 0) {
    // The counts are the authority on whether the ledger is empty; `filtered`
    // only stands in while they load. Reading it first would let a transient
    // empty page (the two queries settle independently) claim a full ledger
    // is empty.
    const nothingAtAll = counts ? counts.total === 0 : !filtered;
    return nothingAtAll ? (
      <div data-testid="empty-nothing" className="flex flex-col items-center gap-2 py-16">
        <Inbox className="size-6 text-fg-faint" />
        <p className="text-sm text-fg-faint">{t("budget.transactions.emptyNothing")}</p>
      </div>
    ) : (
      <div data-testid="empty-no-match" className="flex flex-col items-center gap-3 py-16">
        <Filter className="size-6 text-fg-faint" />
        <p className="text-sm text-fg-faint">{t("budget.transactions.emptyNoMatch")}</p>
        {filtered && (
          <Button variant="ghost" data-testid="empty-clear-filters" onClick={onClearFilters}>
            {t("budget.transactions.clearAll")}
          </Button>
        )}
      </div>
    );
  }

  const widths = showChecked ? WIDTHS_CHECKED : WIDTHS;

  return (
    <div className="flex flex-col">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-fg-faint">
            <th className={`py-2 pl-2 font-medium ${widths[0]}`}>
              {t("budget.transactions.columns.transaction")}
            </th>
            <th className={`py-2 font-medium ${widths[1]}`}>
              {t("budget.transactions.columns.date")}
            </th>
            <th className={`py-2 font-medium ${widths[2]}`}>
              {t("budget.transactions.columns.account")}
            </th>
            <th className={`py-2 font-medium ${widths[3]}`}>
              {t("budget.transactions.columns.category")}
            </th>
            <th className={`py-2 font-medium ${widths[4]}`}>
              {t("budget.transactions.columns.tags")}
            </th>
            {showChecked && (
              <th
                className="w-[6%] py-2 text-center font-medium"
                aria-label={t("budget.transactions.checked")}
              >
                <Check className="mx-auto size-4" aria-hidden="true" />
              </th>
            )}
            <th className={`py-2 pr-2 text-right font-medium ${widths[5]}`}>
              {t("budget.transactions.columns.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              tx={row}
              showChecked={showChecked}
              selected={props.isSelected(row.id)}
              anySelected={props.anySelected}
              onToggleSelect={props.onToggleSelect}
              onOpenCategory={props.onOpenCategory}
              onOpenTags={props.onOpenTags}
              onToggleChecked={props.onToggleChecked}
            />
          ))}
        </tbody>
      </table>
      <div ref={sentinel} className="h-px" />
      {hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            data-testid="load-more"
            onClick={onLoadMore}
            disabled={fetchingNextPage}
          >
            {fetchingNextPage
              ? t("budget.transactions.loadingMore")
              : t("budget.transactions.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
