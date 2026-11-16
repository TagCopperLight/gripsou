import type { QueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import type { ProviderGroup } from "./wire";
import { anySyncing } from "../lib/connectionState";
import type { PrefsPatch } from "../lib/prefsPatch";

function invalidateAll(qc: QueryClient, groups: readonly (readonly unknown[])[]) {
  return Promise.all(groups.map(async (queryKey) => {
    // invalidateQueries alone reuses an initial fetch whose response can predate this write.
    await qc.cancelQueries({ queryKey });
    await qc.invalidateQueries({ queryKey });
  }));
}

// Never cancels an in-flight fetch: that would waste its work.
function invalidateQuietly(
  qc: QueryClient,
  groups: readonly (readonly unknown[])[],
  refetchType: "active" | "none" = "active",
) {
  for (const queryKey of groups)
    qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false });
}

export function afterSyncFinished(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.netWorth(),
    keys.accounts(),
    keys.accountSeries(),
    keys.holdings(),
    keys.holdingPrices(),
    keys.holdingLots(),
    keys.investmentReturns(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.budgetCategories(),
    keys.budgetTags(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

// If the first status read already says idle, the watcher has no earlier snapshot to compare, so refresh the data too.
export async function afterSyncRequested(qc: QueryClient) {
  const before = qc.getQueryData<ProviderGroup[]>(keys.connections());
  await invalidateAll(qc, [keys.connections()]);
  const next = qc.getQueryData<ProviderGroup[]>(keys.connections());
  if (!before && next && !anySyncing(next)) await afterSyncFinished(qc);
}

export function afterConnectFailed(qc: QueryClient) {
  return invalidateAll(qc, [keys.connections()]);
}

export function afterAccountEdit(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.accounts(),
    keys.connections(),
    keys.accountSeries(),
    keys.holdings(),
    keys.investmentReturns(),
    keys.transactions(),
    keys.transactionCounts(),
  ]);
}

export function afterConnectionDeleted(qc: QueryClient) {
  return Promise.all([invalidateAll(qc, [keys.connections()]), afterSyncFinished(qc)]);
}

export function afterLotsSaved(qc: QueryClient, holdingId: string) {
  return invalidateAll(qc, [
    keys.holdings(),
    keys.investmentReturns(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.netWorth(),
    keys.accountSeries(),
    keys.holdingLots(holdingId),
    keys.holdingPrices(holdingId),
  ]);
}

export function afterSessionChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.sessions()]);
}

// Confirming a setup signs the user's other sessions out.
export function afterMfaChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.mfaStatus(), keys.sessions()]);
}

export function afterUserChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.users()]);
}

export function afterBudgetCategoryCreated(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetCategories()]);
}

export function afterBudgetTagCreated(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetTags()]);
}

export function afterBudgetCategoryReorder(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetCategories()]);
}

export function afterBudgetCategoryChange(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.budgetCategories(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

export function afterBudgetTagChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetTags(), keys.transactions(), keys.transactionCounts()]);
}

export function afterTransactionChange(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.budgetCategories(),
    keys.budgetTags(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiStatus(),
  ]);
}

export function afterCheckedChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.transactions()]);
}

export function afterReviewChange(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.budgetCategories(),
    keys.budgetAiStatus(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.budgetSummary(),
    keys.budgetTrend(),
  ]);
}

export function afterCategorizeRequested(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetAiStatus()]);
}

// Transactions are only marked stale: refetching every loaded page on each poll would reshuffle rows under the cursor.
export function afterAiRunProgress(qc: QueryClient) {
  invalidateQuietly(qc, [keys.budgetSummary(), keys.budgetTrend(), keys.budgetAiUsage()]);
  invalidateQuietly(qc, [keys.transactions(), keys.transactionCounts()], "none");
}

export function afterAiRunFinished(qc: QueryClient) {
  return invalidateAll(qc, [
    keys.budgetCategories(),
    keys.transactions(),
    keys.transactionCounts(),
    keys.budgetLatestMonth(),
    keys.budgetSummary(),
    keys.budgetTrend(),
    keys.budgetAiUsage(),
  ]);
}

export function afterBudgetAiSettingsChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetAiSettings(), keys.budgetAiStatus()]);
}

export function afterBudgetAiPricesChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.budgetAiUsage()]);
}

export function afterProviderChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.providers(), keys.providersEnabled()]);
}

export function afterApiKeyChange(qc: QueryClient) {
  return invalidateAll(qc, [keys.apiKeys(), keys.budgetAiSettings(), keys.budgetAiStatus()]);
}

// Currency and time zone change server-converted figures, so they refetch everything; formatting prefs apply in the browser.
const PREF_EFFECTS: { [K in keyof PrefsPatch]?: "everything" | readonly (readonly unknown[])[] } = {
  currency: "everything",
  timeZone: "everything",
  budgetAiThreshold: [keys.transactions(), keys.transactionCounts(), keys.budgetAiStatus()],
  budgetAiEnabled: [keys.budgetAiStatus()],
};

export async function afterPrefsSaved(qc: QueryClient, patch: PrefsPatch) {
  const effects = (Object.keys(patch) as (keyof PrefsPatch)[]).map((key) => PREF_EFFECTS[key]);
  if (effects.includes("everything")) {
    await qc.cancelQueries();
    await qc.invalidateQueries();
    return;
  }
  await invalidateAll(qc, effects.flatMap((groups) => (Array.isArray(groups) ? groups : [])));
}
