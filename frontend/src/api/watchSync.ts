import { hashKey, type QueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { afterSyncFinished } from "./invalidate";
import { flattenConnections, type ProviderGroup } from "./types";

const CONNECTIONS_HASH = hashKey(keys.connections());
const watchedClients = new WeakSet<QueryClient>();

// Observe each connection, not the global spinner: one connection can finish
// while another runs, or finish entirely between two status checks.
export function watchSync(qc: QueryClient) {
  if (watchedClients.has(qc)) return;
  watchedClients.add(qc);
  let last = qc.getQueryData<ProviderGroup[]>(keys.connections());
  qc.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== CONNECTIONS_HASH) return;
    if (event.type === "removed") {
      last = undefined;
      return;
    }
    if (event.type !== "updated" || event.action.type !== "success") return;
    const next = event.query.state.data as ProviderGroup[];
    const prev = last;
    last = next;
    if (!prev) return;
    const previous = new Map(flattenConnections(prev).map((c) => [c.id, c]));
    const finished = flattenConnections(next).some((c) => {
      const before = previous.get(c.id);
      const wasRunning = before?.status === "syncing" || before?.status === "awaiting";
      const running = c.status === "syncing" || c.status === "awaiting";
      return (wasRunning && !running)
        || (c.lastSyncAt !== null && c.lastSyncAt !== before?.lastSyncAt);
    });
    if (finished) void afterSyncFinished(qc);
  });
}
