import type { QueryClient } from "@tanstack/react-query";
import { keys } from "./keys";

// What each domain event makes stale, named once.
//
// A mutation should call one of these rather than listing keys itself — the
// list is the thing that kept drifting. Adding a new
// screen means adding its key to the groups it belongs to, here, not auditing
// every mutation.

function invalidateAll(qc: QueryClient, groups: readonly (readonly unknown[])[]) {
  for (const queryKey of groups) qc.invalidateQueries({ queryKey });
}

// For refreshes nobody asked for (a background run moving on): never cancel a
// fetch already in flight, which would throw its work away only to start it
// again.
function invalidateQuietly(
  qc: QueryClient,
  groups: readonly (readonly unknown[])[],
  refetchType: "active" | "none" = "active",
) {
  for (const queryKey of groups)
    qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false });
}

// Everything whose numbers come out of synced data. `transactions` is in here
// because ingesting transactions is the main thing a sync does — its absence
// was C-17, which left the Transactions page showing pre-sync rows.
export function afterSyncFinished(qc: QueryClient) {
  invalidateAll(qc, [
    keys.netWorth(),
    keys.distribution(),
    keys.accounts(),
    keys.accountSeries(),
    keys.holdings(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetCategories(),
    keys.budgetTags(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

// Requesting a sync, or finishing a connect (which kicks one). The backend
// answers 202 and works in a detached task, so there is nothing fresh to fetch
// yet — only the connection's new `syncing` state, which starts the poll that
// eventually fires `afterSyncFinished`.
export function afterSyncRequested(qc: QueryClient) {
  invalidateAll(qc, [keys.connections()]);
}

// Renaming/recolouring/retyping an account. The holdings and transactions
// tables both render the account's name and colour from their own payloads, so
// they go stale too — that omission was C-18.
export function afterAccountEdit(qc: QueryClient) {
  invalidateAll(qc, [
    keys.accounts(),
    keys.distribution(),
    keys.accountSeries(),
    keys.holdings(),
    keys.transactions(),
    keys.transactionCounts(),
  ]);
}

// Deleting a connection cascades to its accounts and holdings immediately, so
// every figure on every screen changes at once.
export function afterConnectionDeleted(qc: QueryClient) {
  invalidateAll(qc, [keys.connections()]);
  afterSyncFinished(qc);
}

// A saved lot batch changes the explained quantity, the cost basis and the
// derived history, plus this holding's own purchase list and price history.
// Lot rows are listed and counted on the transactions page, so its counts move
// with them.
export function afterLotsSaved(qc: QueryClient, holdingId: string) {
  invalidateAll(qc, [
    keys.holdings(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.netWorth(),
    keys.accountSeries(),
    keys.holdingLots(holdingId),
    keys.holdingPrices(holdingId),
  ]);
}

export function afterSessionChange(qc: QueryClient) {
  invalidateAll(qc, [keys.sessions()]);
}

export function afterUserChange(qc: QueryClient) {
  invalidateAll(qc, [keys.users()]);
}

// A new category or tag has no rows yet, so only its own list changes.
export function afterBudgetCategoryCreated(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetCategories()]);
}

export function afterBudgetTagCreated(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetTags()]);
}

// Reordering moves the category list and nothing else: no figure and no
// transaction reads the order.
export function afterBudgetCategoryReorder(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetCategories()]);
}

// Editing the taxonomy changes the chips the transactions table draws, so the
// transaction pages go stale with the category/tag list itself. A rename,
// retype or delete also moves every figure built on categories.
export function afterBudgetCategoryChange(qc: QueryClient) {
  invalidateAll(qc, [
    keys.budgetCategories(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

export function afterBudgetTagChange(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetTags(), keys.transactions(), keys.transactionCounts()]);
}

// Assigning a category, tagging a row, or any bulk write. The counts feed the
// header and the `matching / total` readout, so they go stale with the list
// itself — the same omission that was C-17 for the list.
export function afterTransactionChange(qc: QueryClient) {
  invalidateAll(qc, [
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

// The ✓ is the user's own bookkeeping: no count, figure or review line reads
// it, only the row itself.
export function afterCheckedChange(qc: QueryClient) {
  invalidateAll(qc, [keys.transactions()]);
}

// Accepting, correcting or undoing a review line: the queue count and every
// figure built on categories move together.
export function afterReviewChange(qc: QueryClient) {
  invalidateAll(qc, [
    keys.budgetAiStatus(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetSummary(),
    keys.budgetTrend(),
  ]);
}

// The review threshold decides which AI guesses "need review": the flag on
// each row, the needs-review filter's counts and the review queue's size.
export function afterReviewThresholdChange(qc: QueryClient) {
  invalidateAll(qc, [keys.transactions(), keys.transactionCounts(), keys.budgetAiStatus()]);
}

// Asking for a run: the server answers 202 and works in the background, so only
// the status (whose `running` starts the poll) has anything new.
export function afterCategorizeRequested(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetAiStatus()]);
}

// A background AI run filed more rows. The Overview figures refresh live; the
// transactions list and its counts are only marked stale — refetching every
// loaded page on each 5 s poll would reshuffle rows under the user's cursor —
// and are refetched when the run ends.
export function afterAiRunProgress(qc: QueryClient) {
  invalidateQuietly(qc, [keys.budgetSummary(), keys.budgetTrend(), keys.budgetAiUsage()]);
  invalidateQuietly(qc, [keys.transactions(), keys.transactionCounts()], "none");
}

export function afterAiRunFinished(qc: QueryClient) {
  invalidateQuietly(qc, [
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiUsage(),
  ]);
}

// Switching the server's AI provider or model changes whether AI is configured.
export function afterBudgetAiSettingsChange(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetAiSettings(), keys.budgetAiStatus()]);
}

// Prices only feed the cost column.
export function afterBudgetAiPricesChange(qc: QueryClient) {
  invalidateAll(qc, [keys.budgetAiUsage()]);
}
