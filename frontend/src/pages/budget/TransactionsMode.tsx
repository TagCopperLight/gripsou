import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { BreakPairModal } from "../../components/budget/BreakPairModal";
import { BudgetDialog } from "../../components/budget/BudgetDialog";
import { SearchSurface } from "../../components/budget/SearchSurface";
import { TransactionsTable } from "../../components/budget/TransactionsTable";
import { SelectionBar } from "../../components/budget/SelectionBar";
import { CategoryChooser } from "../../components/budget/CategoryChooser";
import { TagChooser } from "../../components/budget/TagChooser";
import { TransactionModal } from "../../components/budget/TransactionModal";
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
 *  row becomes `user`-sourced, which clears the confidence and the review flag
 *  (spec §3.1). */
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

  const [categoryFor, setCategoryFor] = useState<Transaction | null>(null);
  // Only the id is held: the chooser stays open across several optimistic
  // writes, so the row it acts on must be re-derived from `rows` on every
  // render (mirrors `FilterPanel`'s functional `patchFilters`) — a frozen
  // `Transaction` snapshot goes stale after the first toggle and every
  // following toggle recomputes `tagIds` from that stale set, destroying
  // whatever the previous toggle just added (see CRITICAL finding 1).
  const [tagsForId, setTagsForId] = useState<string | null>(null);
  // The control each chooser hangs under — captured at click time, since the
  // chooser is now a popover anchored to its trigger rather than a modal.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [applyOffer, setApplyOffer] = useState<{ id: string; categoryId: string | null; count: number } | null>(null);
  // A category write held back until the user agrees to dissolve the
  // internal-transfer pairs it would break. `count` is 1 for a single row —
  // the row itself says whether it is paired — and the server's figure for the
  // two multi-row paths, whose target set the client may never have loaded.
  const [breakPair, setBreakPair] = useState<{ count: number; run: () => void } | null>(null);
  // Spec §5.2/§5.4 — a failed row or bulk write must surface a recoverable
  // inline message, and a successful bulk write must report how many rows it
  // touched. Follows the idiom phase 2 already established next door
  // (`TagsSurface`, `CategoriesSurface`, `TagRow`): `budgetErrorKey` picks the
  // translation key, `role="alert"` + the red text class renders it.
  const [writeErrorKey, setWriteErrorKey] = useState<string | null>(null);
  const [bulkUpdated, setBulkUpdated] = useState<number | null>(null);
  const [merchantTx, setMerchantTx] = useState<Transaction | null>(null);

  const rows = list.data?.pages.flat() ?? [];

  // Two shapes, mirroring `count`: "all shown" is a set the client never
  // enumerates, so only the server can total it; an explicit id selection is
  // always a subset of the loaded rows, so it is summed here.
  const selectionTotal =
    selection.mode === "allShown"
      ? (counts.data?.matchingTotal ?? "0")
      : sumDecimals(rows.filter((r) => selection.ids.has(r.id)).map((r) => r.amountReporting));
  const tagsFor = tagsForId ? (rows.find((r) => r.id === tagsForId) ?? null) : null;

  const onWriteError = (err: unknown) => setWriteErrorKey(budgetErrorKey(err));

  const assignToRow = (tx: Transaction, categoryId: string | null) => {
    // Recategorising half of an auto-paired transfer dissolves the pair on
    // both sides — confirm before writing, not after.
    if (tx.isTransfer) {
      setBreakPair({ count: 1, run: () => writeToRow(tx, categoryId) });
      return;
    }
    writeToRow(tx, categoryId);
  };

  const writeToRow = (tx: Transaction, categoryId: string | null) => {
    setWriteErrorKey(null);
    setBreakPair(null);
    patch.mutate(
      {
        id: tx.id,
        body: { categoryId },
        // `isTransfer` goes too: the pair is dissolved by this write, so the
        // row must stop claiming to be one rather than contradicting its new
        // category until the refetch lands. The *other* half becomes an
        // orphan, but the client cannot know which row that is — that one
        // arrives via the invalidation.
        optimistic: { ...optimisticCategory(categoryId, categories.data), isTransfer: false },
      },
      {
        // The row is already saved; this only offers to widen the correction
        // to the rows that share the description (spec §5.4).
        onSuccess: (res) => {
          if (res.sameDescriptionCount > 0) {
            setApplyOffer({ id: tx.id, categoryId, count: res.sameDescriptionCount });
          }
        },
        onError: onWriteError,
      },
    );
  };

  // Load-bearing: this is the DEBOUNCED `query`, the exact same value the
  // list and counts are reading — never `toQuery(filters)` recomputed here.
  // That equality is what makes "all shown" write to precisely the set the
  // user is looking at; recomputing from `filters` would desync the view
  // from the write the instant the debounce window hasn't closed yet.
  const bulkTarget = () =>
    selection.mode === "allShown" ? { filter: query } : { ids: [...selection.ids] };

  // §4.4/finding 3b: `matching_transaction_ids` returns an empty vec for the
  // lots bucket even though `counts.matching` still counts lot rows — a lot
  // row carries no budget, so "select all shown" cannot mean anything in
  // that bucket and must not be offered as if it did.
  const lotsBucketSelected = filters.bucket === "lots";

  /** Widens a correction to every row sharing the description. The server
   *  refuses an unconfirmed write that would dissolve pairs, reporting how
   *  many; we then ask, and re-send the identical body with the flag. */
  const runApplyToDescription = (id: string, categoryId: string | null, confirmBreakPairs: boolean) => {
    applyToDescription.mutate(
      { id, categoryId, confirmBreakPairs },
      {
        onSuccess: (res) => {
          if (res.pendingPairBreaks) {
            setBreakPair({
              count: res.pendingPairBreaks,
              run: () => runApplyToDescription(id, categoryId, true),
            });
            return;
          }
          setBreakPair(null);
          setApplyOffer(null);
        },
        onError: onWriteError,
      },
    );
  };

  const runBulk = (
    body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked">,
    confirmBreakPairs = false,
  ) => {
    setWriteErrorKey(null);
    setBulkUpdated(null);
    // The target is captured once, so the confirmation re-sends the set the
    // user actually looked at — re-deriving it after the modal could pick up a
    // selection or filter that moved underneath.
    const target = bulkTarget();
    bulk.mutate(
      { ...target, ...body, ...(confirmBreakPairs ? { confirmBreakPairs: true } : {}) },
      {
        onSuccess: (res) => {
          // Refused, not applied: nothing was written, so the selection stays
          // and no "N rows updated" is claimed.
          if (res.pendingPairBreaks) {
            setBreakPair({
              count: res.pendingPairBreaks,
              run: () =>
                bulk.mutate(
                  { ...target, ...body, confirmBreakPairs: true },
                  {
                    onSuccess: (done) => {
                      setBreakPair(null);
                      clearSelection();
                      setBulkUpdated(done.updated);
                    },
                    onError: onWriteError,
                  },
                ),
            });
            return;
          }
          clearSelection();
          setBulkUpdated(res.updated);
        },
        onError: onWriteError,
      },
    );
  };

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
          onRetry={() => void list.refetch()}
          hasNextPage={Boolean(list.hasNextPage)}
          fetchingNextPage={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          onClearFilters={() => setFilters({ ...EMPTY_FILTERS })}
          isSelected={isSelected}
          anySelected={anySelected}
          onToggleSelect={toggleRow}
          // Clicking the same control again puts its chooser away: `Popover`
          // exempts its anchor from the outside-click close.
          onOpenCategory={(tx, el) => {
            setAnchor(el);
            setCategoryFor((prev) => (prev?.id === tx.id ? null : tx));
          }}
          onOpenTags={(tx, el) => {
            setAnchor(el);
            setTagsForId((prev) => (prev === tx.id ? null : tx.id));
          }}
          onToggleChecked={(tx) =>
            patch.mutate(
              { id: tx.id, body: { checked: !tx.checked }, optimistic: { checked: !tx.checked } },
              { onError: onWriteError },
            )
          }
          onOpenMerchant={setMerchantTx}
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
          onClose={() => setCategoryFor(null)}
          anchor={anchor}
        />
      )}

      {tagsFor && (
        <TagChooser
          selectedIds={tagsFor.tags.map((tag) => tag.id)}
          onToggle={(id) => {
            // `tagIds` is a FULL REPLACE server-side — there is no add/remove
            // split on the row patch — so a toggle sends the whole new set,
            // read from the LIVE row (`tagsFor`, re-derived from `rows` every
            // render) so a rapid second toggle builds on the first one's
            // optimistic result instead of a stale snapshot.
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
            patch.mutate(
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
        <BudgetDialog
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
                onClick={() => runApplyToDescription(applyOffer.id, applyOffer.categoryId, false)}
              >
                {t("budget.transactions.applyToAllConfirm")}
              </Button>
            </div>
          }
        >
          <p data-testid="apply-to-all" className="text-sm text-fg-dim">
            {t("budget.transactions.applyToAllBody", { count: applyOffer.count })}
          </p>
        </BudgetDialog>
      )}

      {merchantTx && <TransactionModal tx={merchantTx} onClose={() => setMerchantTx(null)} />}
    </div>
  );
}
