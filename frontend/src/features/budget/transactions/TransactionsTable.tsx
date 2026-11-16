import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, Inbox } from "lucide-react";

import { CardError } from "../../../ui/CardError";
import { Button } from "../../../ui/Button";
import { COL_PAD, gridTracks } from "./transactionsGrid";
import { GridTable, TableEmpty } from "../../../ui/GridTable";
import { HEAD_CELL, ROW_CELLS } from "../../../ui/gridTable";
import type { Transaction, TransactionCounts } from "../../../api/wire";
import { useLoadOnScroll } from "../../../lib/useLoadOnScroll";
import { staleClass } from "../../../ui/stale";
import { Bone, BoneRows, TextBone } from "../../../ui/Skeleton";

type TransactionsTableProps = {
  rows: Transaction[];
  showChecked: boolean;
  counts?: TransactionCounts;
  filtered: boolean;
  loading: boolean;
  stale: boolean;
  error: boolean;
  onRetry: () => void;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
  onConnect: () => void;
  renderRow: (tx: Transaction) => ReactNode;
};

/** No column tracks content except the amount, so a filter change shifts nothing. Overflow is handled inside each cell. */

export function TransactionsTable(props: TransactionsTableProps) {
  const { t } = useTranslation();
  const {
    rows, showChecked, counts, filtered, loading, stale, error, onRetry,
    hasNextPage, fetchingNextPage, onLoadMore, onClearFilters, onConnect, renderRow,
  } = props;
  // Infinite scroll; the button stays as the accessible fallback.
  const sentinel = useLoadOnScroll(hasNextPage, fetchingNextPage, onLoadMore);

  if (error) {
    return (
      <div data-testid="table-state">
        <CardError onRetry={onRetry} className="h-40" />
      </div>
    );
  }

  const head = (
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
  );

  if (loading) {
    return (
      <GridTable busy tracks={gridTracks(showChecked)} head={head}>
        <BoneRows rows={4} className={ROW_CELLS}>
          {(w) => (
            <>
              <td role="cell" className={`py-2.25 ${COL_PAD.transaction}`}>
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <Bone className="size-8 shrink-0 rounded-lg" />
                  <TextBone text="text-sm" style={{ width: w * 2.4 }} />
                </span>
              </td>
              <td role="cell" className={`py-2.25 ${COL_PAD.date}`}>
                <TextBone text="text-sm" className="w-20" />
              </td>
              <td role="cell" className={`py-2.25 ${COL_PAD.account}`}>
                <span className="flex items-center gap-2">
                  <Bone className="size-3 rounded" />
                  <TextBone text="text-sm" className="w-16" />
                </span>
              </td>
              <td role="cell" className={`py-2.25 ${COL_PAD.category}`}>
                <Bone className="h-6 rounded-xl" style={{ width: w * 2 }} />
              </td>
              <td role="cell" className={`py-2.25 ${COL_PAD.tags}`} />
              {showChecked && <td role="cell" className={`py-2.25 ${COL_PAD.checked}`} />}
              <td role="cell" className={`justify-end py-2.25 ${COL_PAD.amount}`}>
                <TextBone text="text-sm" className="w-16" />
              </td>
            </>
          )}
        </BoneRows>
      </GridTable>
    );
  }

  if (rows.length === 0) {
    // The counts decide whether the ledger is empty: `filtered` can be a transient empty page while the two queries settle.
    const nothingAtAll = counts ? counts.total === 0 : !filtered;
    return (
      <div className={staleClass(stale)}>
        {nothingAtAll ? (
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
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* The tracks have floors, so a narrow viewport scrolls the table.
          The sentinel stays outside it: `overflow-x` would make it the sentinel's scroll parent and undo the preloading margin. */}
      <GridTable tracks={gridTracks(showChecked)} head={head} stale={stale}>
        {rows.map(renderRow)}
      </GridTable>
      <div ref={sentinel} className="h-px" />
      {hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            data-testid="load-more"
            onClick={onLoadMore}
            busy={fetchingNextPage}
            busyLabel={t("budget.transactions.loadingMore")}
          >
            {t("budget.transactions.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
