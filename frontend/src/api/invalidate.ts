import type { QueryClient } from "@tanstack/react-query";
import { keys } from "./keys";

// What each domain event makes stale, named once.
//
// A mutation should call one of these rather than listing keys itself — the
// list is the thing that kept drifting (AUDIT.md C-17, C-18, Z-6). Adding a new
// screen means adding its key to the groups it belongs to, here, not auditing
// every mutation.

function invalidateAll(qc: QueryClient, groups: readonly (readonly unknown[])[]) {
  for (const queryKey of groups) qc.invalidateQueries({ queryKey });
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
export function afterLotsSaved(qc: QueryClient, holdingId: string) {
  invalidateAll(qc, [
    keys.holdings(),
    keys.transactions(),
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
