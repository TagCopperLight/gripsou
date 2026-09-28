import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Filter, Inbox } from "lucide-react";

import { TransactionRow } from "./TransactionRow";
import { CardState } from "../CardState";
import { Button } from "../Button";
import { COL_PAD, MIN_TABLE_WIDTH, gridTemplate } from "./transactionsGrid";
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
  onOpenCategory: (tx: Transaction, anchor: HTMLElement) => void;
  onOpenTags: (tx: Transaction, anchor: HTMLElement) => void;
  onToggleChecked: (tx: Transaction) => void;
};

/** Nothing shifts when a filter changes the content: the column tracks
 *  live in `transactionsGrid`, and none of them is content-derived except the
 *  amount, which is allowed to widen for a genuinely bigger number. Overflow is
 *  handled inside each cell, never by the column. */

/** Nearest scrollable ancestor, which is the element an IntersectionObserver
 *  has to use as its root for `rootMargin` to mean anything. Resolved by
 *  walking the DOM rather than hard-coding the shell's `<main>`, so moving the
 *  table somewhere else cannot quietly turn preloading back off. null (no
 *  scrollable ancestor) is the observer's default: the viewport. */
function scrollParent(node: Element): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

export function TransactionsTable(props: TransactionsTableProps) {
  const { t } = useTranslation();
  const {
    rows, showChecked, counts, filtered, loading, error, onRetry,
    hasNextPage, fetchingNextPage, onLoadMore, onClearFilters,
  } = props;
  // Infinite scroll. The button below stays as the accessible fallback
  // and is what most tests drive, since jsdom has no IntersectionObserver.
  //
  // One observer per mounted sentinel, never per render: the table re-renders
  // on every keystroke and selection click, and a fresh observer reports its
  // first reading at once — pages would load because something rendered, not
  // because the user scrolled. The callback reads the latest props through a
  // ref instead.
  const latest = useRef({ hasNextPage, fetchingNextPage, onLoadMore });
  useLayoutEffect(() => {
    latest.current = { hasNextPage, fetchingNextPage, onLoadMore };
  });
  const observed = useRef<{ observer: IntersectionObserver; node: Element } | null>(null);
  const sentinel = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasNextPage: more, fetchingNextPage: busy, onLoadMore: load } = latest.current;
        if (entries.some((e) => e.isIntersecting) && more && !busy) load();
      },
      { root: scrollParent(node), rootMargin: "2000px 0px" },
    );
    observer.observe(node);
    observed.current = { observer, node };
    return () => {
      observer.disconnect();
      observed.current = null;
    };
  }, []);
  // A page just landed: the sentinel may still be in range (a short page, a
  // tall window), and an observer only reports changes. Observing again asks
  // for one fresh reading of where it stands now.
  useEffect(() => {
    const o = observed.current;
    if (!o || !hasNextPage || fetchingNextPage) return;
    o.observer.unobserve(o.node);
    o.observer.observe(o.node);
  }, [hasNextPage, fetchingNextPage]);

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

  return (
    <div className="flex flex-col">
      {/* The tracks have floors, so a narrow viewport scrolls the table rather
          than crushing a column. The sentinel below stays outside this box:
          `overflow-x` would make it the sentinel's scroll parent and quietly
          undo the preloading margin. */}
      <div className="overflow-x-auto">
        <table
          role="table"
          className="grid w-full text-sm"
          style={{ gridTemplateColumns: gridTemplate(showChecked), minWidth: MIN_TABLE_WIDTH }}
        >
          {/* `display: contents` drops the groups out of the layout so the rows
              themselves are the grid's items — and, with them, their implicit
              ARIA roles, which is why every element here names its own. */}
          <thead role="rowgroup" className="contents">
            {/* Same head treatment as every other table in the app (holdings,
             *  users, asset modal): 11px uppercase mono, faint, wide-tracked. */}
            <tr
              role="row"
              className="col-span-full grid grid-cols-subgrid text-left text-[11px] font-mono uppercase tracking-wide text-fg-faint"
            >
              <th role="columnheader" className={`flex items-center py-2 font-medium ${COL_PAD.transaction}`}>
                {t("budget.transactions.columns.transaction")}
              </th>
              <th role="columnheader" className={`flex items-center py-2 font-medium ${COL_PAD.date}`}>
                {t("budget.transactions.columns.date")}
              </th>
              <th role="columnheader" className={`flex items-center py-2 font-medium ${COL_PAD.account}`}>
                {t("budget.transactions.columns.account")}
              </th>
              <th role="columnheader" className={`flex items-center py-2 font-medium ${COL_PAD.category}`}>
                {t("budget.transactions.columns.category")}
              </th>
              <th role="columnheader" className={`flex items-center py-2 font-medium ${COL_PAD.tags}`}>
                {t("budget.transactions.columns.tags")}
              </th>
              {showChecked && (
                <th
                  role="columnheader"
                  className={`flex items-center justify-center py-2 font-medium ${COL_PAD.checked}`}
                  aria-label={t("budget.transactions.checked")}
                >
                  <Check className="size-4" aria-hidden="true" />
                </th>
              )}
              <th
                role="columnheader"
                className={`flex items-center justify-end py-2 font-medium ${COL_PAD.amount}`}
              >
                {t("budget.transactions.columns.amount")}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="contents">
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
      </div>
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
