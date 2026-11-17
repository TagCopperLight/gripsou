import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showDone } from "../../../lib/errorToasts";
import { useNavigate } from "@tanstack/react-router";

import { Surface } from "../../../ui/Surface";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { Button } from "../../../ui/Button";
import { CardTitle } from "../../../ui/CardTitle";
import { usePrivacy } from "../../../auth/usePrivacy";
import { BreakPairModal } from "../BreakPairModal";
import { Dialog } from "../../../ui/Dialog";
import { usePopover } from "../../../ui/usePopover";
import { SearchSurface } from "./SearchSurface";
import { TransactionsTable } from "./TransactionsTable";
import { TransactionRow } from "./TransactionRow";
import { TransactionSheet } from "./TransactionSheet";
import { SelectionBar } from "./SelectionBar";
import { CategoryChooser } from "../CategoryChooser";
import { TagChooser } from "../TagChooser";
import { useBudget } from "../budgetContext";
import {
  useApplyToDescription, useBudgetCategories, useBulkTransactions, usePatchTransaction,
} from "../../../api/budget";
import { useTransactionCounts, useTransactions } from "../../../api/transactions";
import { usePhone } from "../../../ui/usePhone";
import { useAuth } from "../../../auth/context";
import { useDebouncedValue } from "../../../lib/useDebouncedValue";
import { EMPTY_FILTERS, isFiltered, toQuery } from "../../../lib/budgetFilters";
import { breaksKnownPair, useBudgetWrites } from "../useBudgetWrites";
import { sumDecimals } from "../../../lib/decimal";
import type { BulkBody, PatchResult, Transaction, WriteResult } from "../../../api/wire";

export function TransactionsMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { prefs } = useAuth();
  const privacy = usePrivacy();
  const phone = usePhone();
  const { filters, setFilters, selection, isSelected, toggleRow, selectAllShown, anySelected, clearSelection } =
    useBudget();

  const [debouncedSearch, submitSearch] = useDebouncedValue(filters.search, 150);
  const query = toQuery({ ...filters, search: debouncedSearch });

  const list = useTransactions(query);
  const counts = useTransactionCounts(query);
  const categories = useBudgetCategories();
  const patch = usePatchTransaction();
  const applyToDescription = useApplyToDescription();
  const bulk = useBulkTransactions();
  // Stable references keep the row callbacks' identity across renders.
  const { fetchNextPage, refetch } = list;
  const { mutate: patchRow } = patch;

  // Choosers hold the row id, not a snapshot: a stale row would make a second tag toggle undo the first.
  const chooser = usePopover<`category:${string}` | `tags:${string}`>();
  const [chooserKind, chooserId] = chooser.key?.split(":") ?? [];
  const [applyOffer, setApplyOffer] = useState<{ id: string; categoryId: string | null; count: number } | null>(null);
  const writes = useBudgetWrites();
  const { start: startWrite, fail: onWriteError } = writes;

  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  // An id, not a snapshot: the sheet follows the row through its edits.
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? (rows.find((r) => r.id === detailId) ?? null) : null;
  const onOpenDetail = useCallback((tx: Transaction) => setDetailId(tx.id), []);

  // "All shown" is totalled by the server; an explicit selection is summed here.
  const selectionTotal =
    selection.mode === "allShown"
      ? (counts.data?.matchingTotal ?? "0")
      : sumDecimals(
          rows
            .filter((r) => selection.ids.has(r.id) && r.amountReporting !== null)
            .map((r) => r.amountReporting!),
        );
  const selectionFxMissing =
    selection.mode === "allShown"
      ? Boolean(counts.data?.fxMissing)
      : rows.some((r) => selection.ids.has(r.id) && r.amountReporting === null);
  const chosen = chooserId ? (rows.find((r) => r.id === chooserId) ?? null) : null;
  const categoryFor = chooserKind === "category" ? chosen : null;
  const tagsFor = chooserKind === "tags" ? chosen : null;

  const assignToRow = (tx: Transaction, categoryId: string | null) => {
    writes.write<PatchResult>(
      (confirm, callbacks) =>
        patchRow({ id: tx.id, body: { categoryId, confirmBreakPairs: confirm }, optimistic: true }, callbacks),
      {
        askFirst: breaksKnownPair(tx, categories.data?.find((c) => c.id === categoryId)) ? 1 : 0,
        onDone: (res) => {
          const count = res.sameDescriptionCount ?? 0;
          if (count > 0) setApplyOffer({ id: tx.id, categoryId, count });
        },
      },
    );
  };

  // Must be the debounced `query` the list and counts read, so "all shown" writes the set on screen.
  const bulkTarget = () =>
    selection.mode === "allShown" ? { filter: query } : { ids: [...selection.ids] };

  // Lot rows carry no budget, so "select all shown" is not offered for the lots bucket.
  const lotsBucketSelected = filters.bucket === "lots";

  const runApplyToDescription = (id: string, categoryId: string | null) => {
    writes.write<WriteResult>(
      (confirm, callbacks) => applyToDescription.mutate({ id, categoryId, confirmBreakPairs: confirm }, callbacks),
      { onDone: () => setApplyOffer(null) },
    );
  };

  const runBulk = (body: Pick<BulkBody, "categoryId" | "addTagIds" | "checked">) => {
    // Captured once so the confirmation re-sends the set the user saw.
    const target = bulkTarget();
    writes.write<WriteResult>(
      (confirm, callbacks) => bulk.mutate({ ...target, ...body, confirmBreakPairs: confirm }, callbacks),
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
  const { toggle: toggleChooser } = chooser;
  const onOpenCategory = useCallback(
    (tx: Transaction, el: HTMLElement) => toggleChooser(`category:${tx.id}`, el),
    [toggleChooser],
  );
  const onOpenTags = useCallback(
    (tx: Transaction, el: HTMLElement) => toggleChooser(`tags:${tx.id}`, el),
    [toggleChooser],
  );
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
      <Surface>
        <LoadingFrame loading={list.isPending} className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle size="lg" privacy={privacy}>
              {t("budget.transactions.title")}
            </CardTitle>
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

          <SearchSurface counts={counts.data} countsStale={counts.isPlaceholderData} onSubmitSearch={submitSearch} />

          <TransactionsTable
            rows={rows}
            showChecked={prefs.showChecked}
            counts={counts.data}
            filtered={isFiltered(filters)}
            loading={list.isPending}
            stale={list.isPlaceholderData}
            error={list.isError}
            onRetry={onRetry}
            hasNextPage={Boolean(list.hasNextPage)}
            fetchingNextPage={list.isFetchingNextPage}
            onLoadMore={onLoadMore}
            onClearFilters={onClearFilters}
            onConnect={onConnect}
            renderRow={(row) => (
              <TransactionRow
                key={row.id}
                tx={row}
                showChecked={prefs.showChecked}
                phone={phone}
                masked={privacy.masked}
                selected={row.source !== "lot" && isSelected(row.id)}
                anySelected={anySelected}
                onToggleSelect={toggleRow}
                onOpenCategory={onOpenCategory}
                onOpenTags={onOpenTags}
                onToggleChecked={onToggleChecked}
                onOpenDetail={phone ? onOpenDetail : undefined}
              />
            )}
          />
        </LoadingFrame>
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

      {detail && (
        <TransactionSheet
          tx={detail}
          showChecked={prefs.showChecked}
          masked={privacy.masked}
          onOpenCategory={onOpenCategory}
          onOpenTags={onOpenTags}
          onToggleChecked={onToggleChecked}
          onClose={() => setDetailId(null)}
        />
      )}

      {categoryFor && (
        <CategoryChooser
          mode="pick"
          selectedIds={categoryFor.categoryId ? [categoryFor.categoryId] : []}
          onPick={(id) => assignToRow(categoryFor, id)}
          onClose={chooser.close}
          anchor={chooser.anchor}
        />
      )}

      {tagsFor && (
        <TagChooser
          selectedIds={tagsFor.tags.map((tag) => tag.id)}
          onToggle={(id) => {
            // `tagIds` is a full replace server-side: read the live row so a rapid second toggle builds on the first.
            const has = tagsFor.tags.some((tag) => tag.id === id);
            const current = tagsFor.tags.map((tag) => tag.id);
            const next = has ? current.filter((x) => x !== id) : [...current, id];
            startWrite();
            patchRow(
              { id: tagsFor.id, body: { tagIds: next }, optimistic: true },
              { onError: onWriteError },
            );
          }}
          onClose={chooser.close}
          anchor={chooser.anchor}
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
                busy={applyToDescription.isPending}
                busyLabel={t("common.busy.applying")}
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
