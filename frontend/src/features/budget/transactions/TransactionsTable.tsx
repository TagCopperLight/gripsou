import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, Inbox } from "lucide-react";

import { CardState } from "../../../ui/CardState";
import { Button } from "../../../ui/Button";
import { COL_PAD, gridTracks } from "./transactionsGrid";
import { GridTable, TableEmpty } from "../../../ui/GridTable";
import { HEAD_CELL } from "../../../ui/gridTable";
import type { Transaction, TransactionCounts } from "../../../api/wire";
import { useLoadOnScroll } from "../../../lib/useLoadOnScroll";

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
  /** Where "Connect a bank" goes, on an empty ledger. */
  onConnect: () => void;
  /** Draws one row (a `TransactionRow`, keyed by its id). */
  renderRow: (tx: Transaction) => ReactNode;
};

/** Nothing shifts when a filter changes the content: the column tracks
 *  live in `transactionsGrid`, and none of them is content-derived except the
 *  amount, which is allowed to widen for a genuinely bigger number. Overflow is
 *  handled inside each cell, never by the column. */

export function TransactionsTable(props: TransactionsTableProps) {
  const { t } = useTranslation();
  const {
    rows, showChecked, counts, filtered, loading, error, onRetry,
    hasNextPage, fetchingNextPage, onLoadMore, onClearFilters, onConnect, renderRow,
  } = props;
  // Infinite scroll. The button below stays as the accessible fallback
  // and is what most tests drive, since jsdom has no IntersectionObserver.
  const sentinel = useLoadOnScroll(hasNextPage, fetchingNextPage, onLoadMore);

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
      <TableEmpty
        testId="empty-nothing"
        icon={<Inbox />}
        message={t("budget.transactions.emptyNothing")}
        action={(
          <Button variant="outline" padded={false} className="rounded-lg! px-2.75 py-1.5 text-xs" onClick={onConnect}>
            {t("budget.transactions.connect")}
          </Button>
        )}
      />
    ) : (
      <TableEmpty
        testId="empty-no-match"
        icon={<Filter />}
        message={t("budget.transactions.emptyNoMatch")}
        action={filtered && (
          <Button variant="ghost" data-testid="empty-clear-filters" onClick={onClearFilters}>
            {t("budget.transactions.clearAll")}
          </Button>
        )}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* The tracks have floors, so a narrow viewport scrolls the table rather
          than crushing a column. The sentinel below stays outside it:
          `overflow-x` would make it the sentinel's scroll parent and quietly
          undo the preloading margin. */}
      <GridTable
        tracks={gridTracks(showChecked)}
        head={
          <>
            <th role="columnheader" className={`${HEAD_CELL} ${COL_PAD.transaction}`}>
              {t("budget.transactions.columns.transaction")}
            </th>
            <th role="columnheader" className={`${HEAD_CELL} ${COL_PAD.date}`}>
              {t("budget.transactions.columns.date")}
            </th>
            <th role="columnheader" className={`${HEAD_CELL} ${COL_PAD.account}`}>
              {t("budget.transactions.columns.account")}
            </th>
            <th role="columnheader" className={`${HEAD_CELL} ${COL_PAD.category}`}>
              {t("budget.transactions.columns.category")}
            </th>
            <th role="columnheader" className={`${HEAD_CELL} ${COL_PAD.tags}`}>
              {t("budget.transactions.columns.tags")}
            </th>
            {showChecked && (
              <th
                role="columnheader"
                className={`${HEAD_CELL} justify-center ${COL_PAD.checked}`}
                aria-label={t("budget.transactions.checked")}
              >
                <Check className="size-4" aria-hidden="true" />
              </th>
            )}
            <th role="columnheader" className={`${HEAD_CELL} justify-end ${COL_PAD.amount}`}>
              {t("budget.transactions.columns.amount")}
            </th>
          </>
        }
      >
        {rows.map(renderRow)}
      </GridTable>
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
