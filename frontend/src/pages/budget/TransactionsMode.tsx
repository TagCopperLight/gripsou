import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { BreakPairModal } from "../../components/budget/BreakPairModal";
import { Dialog } from "../../components/Dialog";
import { SearchSurface } from "../../components/budget/SearchSurface";
import { TransactionsTable } from "../../components/budget/TransactionsTable";
import { SelectionBar } from "../../components/budget/SelectionBar";
import { CategoryChooser } from "../../components/budget/CategoryChooser";
import { TagChooser } from "../../components/budget/TagChooser";
import { useBudget } from "../../components/budget/budgetContext";
import {
  useApplyToDescription, useBudgetCategories, useBudgetTags, useBulkTransactions, usePatchTransaction,
} from "../../api/budget";
import { useTransactionCounts, useTransactions } from "../../api/hooks";
import { useAuth } from "../../auth/context";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { EMPTY_FILTERS, isFiltered, toQuery } from "../../lib/budgetFilters";
import { budgetErrorKey } from "../../lib/budget";
import { sumDecimals } from "../../lib/money";
import type { BulkBody } from "../../api/budget";
import type { Transaction } from "../../api/types";

/** What the row should look like the instant a category is picked, before the
 *  server answers. It mirrors what the backend does on a user assignment: the
 *  row becomes `user`-sourced, which clears the confidence and the review flag. */
function optimisticCategory(
  categoryId: string | null,
  categories: ReturnType<typeof useBudgetCategories>["data"],
): Partial<Transaction> {
  const c = categories?.find((x) => x.id === categoryId) ?? null;
  return {
    categoryId: c?.id ?? null,
    categoryName: c?.name ?? null,
    categoryDefaultKey: c?.defaultKey ?? null,
    categoryColor: c?.color ?? null,
    categoryIcon: c?.icon ?? null,
    categoryKind: c?.kind ?? null,
    categorySource: c ? "user" : null,
    categoryConfidence: null,
    needsReview: false,
  };
}

/** A tag's place in the catalog; unknown tags sort after every known one. */
function catalogRank(catalog: { id: string }[], id: string): number {
  const i = catalog.findIndex((tag) => tag.id === id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** What every write that can dissolve transfer pairs answers: set means the
 *  server refused it, wrote nothing, and reports how many pairs it would
 *  break. */
type PairBreakAnswer = { pendingPairBreaks?: number | null };
type WriteCallbacks<R> = { onSuccess: (res: R) => void; onError: (err: unknown) => void };
type AnswerOf<H extends () => { mutateAsync: (...args: never[]) => Promise<unknown> }> = Awaited<
  ReturnType<ReturnType<H>["mutateAsync"]>
>;

export function TransactionsMode() {
  const { t } = useTranslation();
  const { prefs } = useAuth();
  const { filters, setFilters, selection, isSelected, toggleRow, selectAllShown, anySelected, clearSelection } =
    useBudget();

  // The search box stays fully responsive; only the fetch waits.
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const query = toQuery({ ...filters, search: debouncedSearch });

  const list = useTransactions(query);
  const counts = useTransactionCounts(query);
  const categories = useBudgetCategories();
  const tagsCatalog = useBudgetTags();
  const patch = usePatchTransaction();
  const applyToDescription = useApplyToDescription();
  const bulk = useBulkTransactions();
  // The stable pieces of the query and mutation results, so the callbacks the
  // table hands to every row keep their identity across renders.
  const { fetchNextPage, refetch } = list;
  const { mutate: patchRow } = patch;

  // Both choosers hold the row's id, never a snapshot: they stay open across
  // optimistic writes, so the row they act on is re-derived from `rows` on
  // every render. A frozen `Transaction` goes stale after the first write —
  // a second tag toggle would rebuild `tagIds` from the stale set and undo the
  // first.
  const [categoryForId, setCategoryForId] = useState<string | null>(null);
  const [tagsForId, setTagsForId] = useState<string | null>(null);
  // The control each chooser hangs under — captured at click time, since the
  // chooser is a popover anchored to its trigger rather than a modal.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [applyOffer, setApplyOffer] = useState<{ id: string; categoryId: string | null; count: number } | null>(null);
  // A write held back until the user agrees to dissolve the internal-transfer
  // pairs it would break; `run` re-sends it confirmed.
  const [breakPair, setBreakPair] = useState<{ count: number; run: () => void } | null>(null);
  // A failed row or bulk write surfaces a recoverable inline message, and a
  // successful bulk write reports how many rows it touched. Both describe the
  // last write only, so every new write clears them.
  const [writeErrorKey, setWriteErrorKey] = useState<string | null>(null);
  const [bulkUpdated, setBulkUpdated] = useState<number | null>(null);

  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);

  // Two shapes, mirroring `count`: "all shown" is a set the client never
  // enumerates, so only the server can total it; an explicit id selection is
  // always a subset of the loaded rows, so it is summed here.
  const selectionTotal =
    selection.mode === "allShown"
      ? (counts.data?.matchingTotal ?? "0")
      : sumDecimals(rows.filter((r) => selection.ids.has(r.id)).map((r) => r.amountReporting));
  const categoryFor = categoryForId ? (rows.find((r) => r.id === categoryForId) ?? null) : null;
  const tagsFor = tagsForId ? (rows.find((r) => r.id === tagsForId) ?? null) : null;

  const startWrite = useCallback(() => {
    setWriteErrorKey(null);
    setBulkUpdated(null);
  }, []);
  const onWriteError = useCallback((err: unknown) => setWriteErrorKey(budgetErrorKey(err)), []);

  /** Every write that can dissolve internal-transfer pairs speaks one
   *  protocol: sent unconfirmed, the server refuses it if it would break a
   *  pair, reports how many, and writes nothing; we ask, and `run` re-sends
   *  the identical write confirmed. Returns the attempt, so a caller that
   *  already knows the answer can ask first. */
  const pairBreakAware = <R extends PairBreakAnswer>(
    send: (confirm: boolean, callbacks: WriteCallbacks<R>) => void,
    onDone: (res: R) => void,
  ) => {
    const attempt = (confirm: boolean) =>
      send(confirm, {
        onSuccess: (res) => {
          if (res?.pendingPairBreaks) {
            setBreakPair({ count: res.pendingPairBreaks, run: () => attempt(true) });
            return;
          }
          setBreakPair(null);
          onDone(res);
        },
        onError: (err) => {
          setBreakPair(null);
          onWriteError(err);
        },
      });
    return attempt;
  };

  const assignToRow = (tx: Transaction, categoryId: string | null) => {
    startWrite();
    // A neutral category counts toward nothing, as the pair does, so the
    // server keeps the pair: no question to ask, and the row stays a transfer.
    const keepsPair = categories.data?.find((c) => c.id === categoryId)?.kind === "neutral";
    const breaksPair = tx.isTransfer && !keepsPair;
    const attempt = pairBreakAware<AnswerOf<typeof usePatchTransaction>>(
      (confirm, callbacks) =>
        patchRow(
          {
            id: tx.id,
            body: { categoryId, ...(confirm ? { confirmBreakPairs: true } : {}) },
            // `isTransfer` goes too when the pair is dissolved by this write,
            // so the row stops claiming to be one rather than contradicting
            // its new category until the refetch lands. The *other* half
            // becomes an orphan, but the client cannot know which row that
            // is — that one arrives via the invalidation.
            optimistic: {
              ...optimisticCategory(categoryId, categories.data),
              isTransfer: tx.isTransfer && !breaksPair,
            },
          },
          callbacks,
        ),
      // The row is saved; this only offers to widen the correction to the
      // rows that share the description.
      (res) => {
        if (res.sameDescriptionCount > 0) {
          setApplyOffer({ id: tx.id, categoryId, count: res.sameDescriptionCount });
        }
      },
    );
    // A row the list already shows as paired is asked about before anything
    // is sent, so its chip never flips to the new category and back while the
    // server refuses. The server still refuses on its own for a row paired
    // since the list was loaded.
    if (breaksPair) setBreakPair({ count: 1, run: () => attempt(true) });
    else attempt(false);
  };

  // Load-bearing: this is the DEBOUNCED `query`, the exact same value the
  // list and counts are reading — never `toQuery(filters)` recomputed here.
  // That equality is what makes "all shown" write to precisely the set the
  // user is looking at; recomputing from `filters` would desync the view
  // from the write the instant the debounce window hasn't closed yet.
  const bulkTarget = () =>
    selection.mode === "allShown" ? { filter: query } : { ids: [...selection.ids] };

  // `matching_transaction_ids` returns nothing for the lots bucket even though
  // `counts.matching` still counts lot rows — a lot row carries no budget, so
  // "select all shown" cannot mean anything in that bucket and must not be
  // offered as if it did.
  const lotsBucketSelected = filters.bucket === "lots";

  /** Widens a correction to every row sharing the description. */
  const runApplyToDescription = (id: string, categoryId: string | null) => {
    startWrite();
    pairBreakAware<AnswerOf<typeof useApplyToDescription>>(
      (confirm, callbacks) => applyToDescription.mutate({ id, categoryId, confirmBreakPairs: confirm }, callbacks),
      () => setApplyOffer(null),
    )(false);
  };

  const runBulk = (body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked">) => {
    startWrite();
    // The target is captured once, so the confirmation re-sends the set the
    // user actually looked at — re-deriving it after the modal could pick up a
    // selection or filter that moved underneath.
    const target = bulkTarget();
    pairBreakAware<AnswerOf<typeof useBulkTransactions>>(
      (confirm, callbacks) =>
        bulk.mutate({ ...target, ...body, ...(confirm ? { confirmBreakPairs: true } : {}) }, callbacks),
      // Only an applied write clears the selection and claims "N rows
      // updated"; a refused one leaves both as they were.
      (res) => {
        clearSelection();
        setBulkUpdated(res.updated);
      },
    )(false);
  };

  const onRetry = useCallback(() => void refetch(), [refetch]);
  const onLoadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const onClearFilters = useCallback(() => setFilters({ ...EMPTY_FILTERS }), [setFilters]);
  // Clicking the same control again puts its chooser away: `Popover` exempts
  // its anchor from the outside-click close.
  const onOpenCategory = useCallback((tx: Transaction, el: HTMLElement) => {
    setAnchor(el);
    setTagsForId(null);
    setCategoryForId((prev) => (prev === tx.id ? null : tx.id));
  }, []);
  const onOpenTags = useCallback((tx: Transaction, el: HTMLElement) => {
    setAnchor(el);
    setCategoryForId(null);
    setTagsForId((prev) => (prev === tx.id ? null : tx.id));
  }, []);
  const onToggleChecked = useCallback(
    (tx: Transaction) => {
      startWrite();
      patchRow(
        { id: tx.id, body: { checked: !tx.checked }, optimistic: { checked: !tx.checked } },
        { onError: onWriteError },
      );
    },
    [patchRow, startWrite, onWriteError],
  );

  return (
    <div className="flex min-h-full flex-col gap-4">
      <Surface className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">{t("budget.transactions.title")}</h2>
          <Button
            variant="ghostStrong"
            data-testid="select-all-shown"
            disabled={!anySelected && lotsBucketSelected}
            title={!anySelected && lotsBucketSelected
              ? t("budget.transactions.selectAllShownDisabledLots")
              : undefined}
            onClick={() => (anySelected ? clearSelection() : selectAllShown())}
          >
            {anySelected
              ? t("budget.transactions.deselectAll")
              : t("budget.transactions.selectAllShown")}
          </Button>
        </div>

        <SearchSurface counts={counts.data} />

        <TransactionsTable
          rows={rows}
          showChecked={prefs.showChecked}
          counts={counts.data}
          filtered={isFiltered(filters)}
          loading={list.isPending}
          error={list.isError}
          onRetry={onRetry}
          hasNextPage={Boolean(list.hasNextPage)}
          fetchingNextPage={list.isFetchingNextPage}
          onLoadMore={onLoadMore}
          onClearFilters={onClearFilters}
          isSelected={isSelected}
          anySelected={anySelected}
          onToggleSelect={toggleRow}
          onOpenCategory={onOpenCategory}
          onOpenTags={onOpenTags}
          onToggleChecked={onToggleChecked}
        />

        {writeErrorKey && (
          <p data-testid="write-error" role="alert" className="flex items-center gap-2 text-xs text-red">
            {t(`budget.transactions.errors.${writeErrorKey}`)}
            <button
              type="button"
              data-testid="write-error-dismiss"
              onClick={() => setWriteErrorKey(null)}
              aria-label={t("common.close")}
              className="cursor-pointer text-red/70 hover:text-red"
            >
              ×
            </button>
          </p>
        )}
      </Surface>

      {bulkUpdated !== null && (
        <p data-testid="bulk-result" className="text-xs text-fg-faint">
          {t("budget.transactions.bulkUpdated", { count: bulkUpdated })}
        </p>
      )}

      <SelectionBar
        matching={counts.data?.matching ?? 0}
        total={selectionTotal}
        showChecked={prefs.showChecked}
        busy={bulk.isPending}
        onAssignCategory={(categoryId) => runBulk({ categoryId })}
        onAddTags={(addTagIds) => runBulk({ addTagIds })}
        onMarkChecked={() => runBulk({ checked: true })}
      />

      {categoryFor && (
        <CategoryChooser
          mode="pick"
          selectedIds={categoryFor.categoryId ? [categoryFor.categoryId] : []}
          onPick={(id) => assignToRow(categoryFor, id)}
          onClose={() => setCategoryForId(null)}
          anchor={anchor}
        />
      )}

      {tagsFor && (
        <TagChooser
          selectedIds={tagsFor.tags.map((tag) => tag.id)}
          onToggle={(id) => {
            // `tagIds` is a FULL REPLACE server-side — there is no add/remove
            // split on the row patch — so a toggle sends the whole new set,
            // read from the live row so a rapid second toggle builds on the
            // first one's optimistic result instead of a stale snapshot.
            const has = tagsFor.tags.some((tag) => tag.id === id);
            const current = tagsFor.tags.map((tag) => tag.id);
            const next = has ? current.filter((x) => x !== id) : [...current, id];
            // Resolved from the tag catalog — same idiom as
            // `optimisticCategory` — so a newly added tag shows its real name
            // and color immediately instead of a blank chip.
            const catalog = tagsCatalog.data ?? [];
            const tags = next
              .map(
                (tid) =>
                  catalog.find((tag) => tag.id === tid) ??
                  tagsFor.tags.find((tag) => tag.id === tid) ?? { id: tid, name: "", color: null },
              )
              // ...and in the catalog's own order, which is the order the
              // server sends a row's tags back in. Left in click order, a tag
              // would sit at the end of the row until the response landed and
              // then jump. A tag the catalog doesn't know (it always does)
              // sorts last, keeping its click order — `sort` is stable.
              .sort((a, b) => catalogRank(catalog, a.id) - catalogRank(catalog, b.id));
            startWrite();
            patchRow(
              { id: tagsFor.id, body: { tagIds: tags.map((tag) => tag.id) }, optimistic: { tags } },
              { onError: onWriteError },
            );
          }}
          onClose={() => setTagsForId(null)}
          anchor={anchor}
        />
      )}

      {breakPair && (
        <BreakPairModal
          count={breakPair.count}
          busy={patch.isPending || bulk.isPending || applyToDescription.isPending}
          onConfirm={breakPair.run}
          onClose={() => setBreakPair(null)}
        />
      )}

      {applyOffer && (
        <Dialog
          title={t("budget.transactions.applyToAllTitle")}
          onClose={() => setApplyOffer(null)}
          busy={applyToDescription.isPending}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setApplyOffer(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                data-testid="apply-to-all-confirm"
                disabled={applyToDescription.isPending}
                onClick={() => runApplyToDescription(applyOffer.id, applyOffer.categoryId)}
              >
                {t("budget.transactions.applyToAllConfirm")}
              </Button>
            </div>
          }
        >
          <p data-testid="apply-to-all" className="text-sm text-fg-dim">
            {t("budget.transactions.applyToAllBody", { count: applyOffer.count })}
          </p>
        </Dialog>
      )}
    </div>
  );
}
