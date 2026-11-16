import { useEffect } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { CompleteConnectionReq, ProviderGroup } from "./wire";
import { keys } from "./keys";
import { watchQuery } from "./watch";
import {
  afterConnectFailed,
  afterConnectionDeleted,
  afterSyncFinished,
  afterSyncRequested,
} from "./invalidate";
import { anySyncing, syncFinished } from "../lib/connectionState";

export function useConnections() {
  const qc = useQueryClient();
  useEffect(
    () => watchQuery<ProviderGroup[]>(qc, keys.connections(), (prev, next) => {
      if (syncFinished(prev, next)) void afterSyncFinished(qc);
    }),
    [qc],
  );
  return useQuery({
    queryKey: keys.connections(),
    queryFn: ({ signal }) => api("GET /connections", { signal }),
    // Check idle connections too: scheduled syncs and other tabs may finish
    // without this page ever seeing a running state.
    refetchInterval: (query) =>
      anySyncing(query.state.data) ? 2000 : 30_000,
  });
}

export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("POST /connections/:id/sync", { params: { id } }),
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useManageConnection() {
  return useMutation({
    mutationFn: (id: string) => api("POST /connections/:id/manage", { params: { id } }),
  });
}

const SYNC_ALL = ["syncAll"];

export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SYNC_ALL,
    mutationFn: () => api("POST /sync"),
    onSuccess: () => afterSyncRequested(qc),
  });
}

/** A "Sync all" request is on its way, from wherever it was started: it syncs
 *  every connection, so each one shows it from the click on. */
export function useSyncAllPending() {
  return useIsMutating({ mutationKey: SYNC_ALL }) > 0;
}

export function useEnabledProviders() {
  return useQuery({
    queryKey: keys.providersEnabled(),
    queryFn: ({ signal }) => api("GET /providers/enabled", { signal }),
  });
}

export function useInitConnection() {
  return useMutation({
    mutationFn: (providerKey: string) =>
      api("POST /connections/init", { body: { providerKey } }),
  });
}

export function useCompleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, params }: CompleteConnectionReq) =>
      api("POST /connections/complete", { body: { connectionId, params } }),
    // A completed connect kicks an initial sync server-side, so the poll that
    // `afterSyncRequested` starts is what eventually refreshes the data views.
    onSuccess: () => afterSyncRequested(qc),
    onError: () => afterConnectFailed(qc),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /connections/:id", { params: { id } }),
    // Deleting cascades to the connection's accounts and holdings immediately,
    // so every dashboard figure changes with it — not just the list.
    onSuccess: () => afterConnectionDeleted(qc),
  });
}
