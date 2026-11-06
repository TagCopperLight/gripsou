import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showDone } from "../../../lib/errorToasts";
import { useNavigate } from "@tanstack/react-router";

import { Surface } from "../../../ui/Surface";
import { Button } from "../../../ui/Button";
import { PrivacyEye } from "../../../ui/PrivateMoney";
import { usePrivacy } from "../../../auth/usePrivacy";
import { BreakPairModal } from "../BreakPairModal";
import { Dialog } from "../../../ui/Dialog";
import { SearchSurface } from "./SearchSurface";
import { TransactionsTable } from "./TransactionsTable";
import { SelectionBar } from "./SelectionBar";
import { CategoryChooser } from "../CategoryChooser";
import { TagChooser } from "../TagChooser";
import { useBudget } from "../budgetContext";
import {
  useApplyToDescription, useBudgetCategories, useBulkTransactions, usePatchTransaction,
} from "../../../api/budget";
import { useTransactionCounts, useTransactions } from "../../../api/transactions";
import { useAuth } from "../../../auth/context";
import { useDebouncedValue } from "../../../lib/useDebouncedValue";
import { EMPTY_FILTERS, isFiltered, toQuery } from "../../../lib/budgetFilters";
import { breaksKnownPair, useBudgetWrites } from "../useBudgetWrites";
import { sumDecimals } from "../../../lib/decimal";
import type { BulkBody, PatchResult, WriteResult } from "../../../api/budget";
import type { Transaction } from "../../../api/types";

export function TransactionsMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { prefs } = useAuth();
  // One eye, by the title, for every amount of the list and the selection.
  const privacy = usePrivacy();
  const { filters, setFilters, selection, isSelected, toggleRow, selectAllShown, anySelected, clearSelection } =
    useBudget();

  // The search box stays fully responsive; only the fetch waits.
  const [debouncedSearch, submitSearch] = useDebouncedValue(filters.search, 150);
  const query = toQuery({ ...filters, search: debouncedSearch });

  const list = useTransactions(query);
  const counts = useTransactionCounts(query);
  const categories = useBudgetCategories();
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
  const writes = useBudgetWrites();
  const { start: startWrite, fail: onWriteError } = writes;

  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);

  // Two shapes, mirroring `count`: "all shown" is a set the client never
  // enumerates, so only the server can total it; an explicit id selection is
  // always a subset of the loaded rows, so it is summed here.
  const selectionTotal =
    selection.mode === "allShown"
      ? (counts.data?.matchingTotal ?? "0")
      : sumDecimals(
          rows
            .filter((r) => selection.ids.has(r.id) && r.amountReporting !== null)
            .map((r) => r.amountReporting!),
        );
  // A row with no exchange rate is left out of that total: it says so.
  const selectionFxMissing =
    selection.mode === "allShown"
      ? Boolean(counts.data?.fxMissing)
      : rows.some((r) => selection.ids.has(r.id) && r.amountReporting === null);
  const categoryFor = categoryForId ? (rows.find((r) => r.id === categoryForId) ?? null) : null;
  const tagsFor = tagsForId ? (rows.find((r) => r.id === tagsForId) ?? null) : null;

  const assignToRow = (tx: Transaction, categoryId: string | null) => {
    writes.write<PatchResult>(
      (confirm, callbacks) =>
        patchRow({ id: tx.id, body: { categoryId, confirmBreakPairs: confirm }, optimistic: true }, callbacks),
      {
        askFirst: breaksKnownPair(tx, categories.data?.find((c) => c.id === categoryId)) ? 1 : 0,
        // The row is saved; this only offers to widen the correction to the
        // rows that share the description.
        onDone: (res) => {
          if (res.sameDescriptionCount > 0) {
            setApplyOffer({ id: tx.id, categoryId, count: res.sameDescriptionCount });
          }
        },
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

  // `matching_transaction_ids` returns nothing for the lots bucket (and
  // `counts.selectable` is 0 there) — a lot row carries no budget, so
  // "select all shown" cannot mean anything in that bucket and must not be
  // offered as if it did.
  const lotsBucketSelected = filters.bucket === "lots";

  /** Widens a correction to every row sharing the description. */
  const runApplyToDescription = (id: string, categoryId: string | null) => {
    writes.write<WriteResult>(
      (confirm, callbacks) => applyToDescription.mutate({ id, categoryId, confirmBreakPairs: confirm }, callbacks),
      { onDone: () => setApplyOffer(null) },
    );
  };

  const runBulk = (body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked">) => {
    // The target is captured once, so the confirmation re-sends the set the
    // user actually looked at — re-deriving it after the modal could pick up a
    // selection or filter that moved underneath.
    const target = bulkTarget();
    writes.write<WriteResult>(
      (confirm, callbacks) => bulk.mutate({ ...target, ...body, confirmBreakPairs: confirm }, callbacks),
      // Only an applied write clears the selection and says "N rows
      // updated" in the corner; a refused one leaves both as they were.
      {
        onDone: (res) => {
          clearSelection();
          showDone(t("budget.transactions.bulkUpdated", { count: res.updated }));
        },
      },
    );
  };

  const onRetry = useCallback(() => void refetch(), [refetch]);
  const onLoadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const onClearFilters = useCallback(() => setFilters({ ...EMPTY_FILTERS }), [setFilters]);
  const onConnect = useCallback(() => void navigate({ to: "/settings/connections" }), [navigate]);
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
        { id: tx.id, body: { checked: !tx.checked }, optimistic: true },
        { onError: onWriteError },
      );
    },
    [patchRow, startWrite, onWriteError],
  );

  return (
    <div className="flex min-h-full flex-col gap-4">
      <Surface className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">
            {t("budget.transactions.title")}
            {privacy.enabled && (
              <span className="ml-3 inline-flex align-middle">
                <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />
              </span>
            )}
          </h2>
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

        <SearchSurface counts={counts.data} onSubmitSearch={submitSearch} />

        <TransactionsTable
          rows={rows}
          showChecked={prefs.showChecked}
          masked={privacy.masked}
          counts={counts.data}
          filtered={isFiltered(filters)}
          loading={list.isPending}
          error={list.isError}
          onRetry={onRetry}
          hasNextPage={Boolean(list.hasNextPage)}
          fetchingNextPage={list.isFetchingNextPage}
          onLoadMore={onLoadMore}
          onClearFilters={onClearFilters}
          onConnect={onConnect}
          isSelected={isSelected}
          anySelected={anySelected}
          onToggleSelect={toggleRow}
          onOpenCategory={onOpenCategory}
          onOpenTags={onOpenTags}
          onToggleChecked={onToggleChecked}
        />

      </Surface>

      <SelectionBar
        matching={counts.data?.selectable ?? 0}
        total={selectionTotal}
        fxMissing={selectionFxMissing}
        showChecked={prefs.showChecked}
        masked={privacy.masked}
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
            startWrite();
            patchRow(
              { id: tagsFor.id, body: { tagIds: next }, optimistic: true },
              { onError: onWriteError },
            );
          }}
          onClose={() => setTagsForId(null)}
          anchor={anchor}
        />
      )}

      {writes.breakPair && (
        <BreakPairModal
          count={writes.breakPair.count}
          busy={patch.isPending || bulk.isPending || applyToDescription.isPending}
          onConfirm={writes.breakPair.confirm}
          onClose={writes.dismissBreakPair}
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
