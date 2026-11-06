import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteJson, getJson, postJson } from "./client";
import type {
  CompleteConnectionReq,
  ConnectionState,
  EnabledProvider,
  InitConnectionResp,
  ManageResp,
  ProviderGroup,
  SyncAllResp,
} from "./wire";
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
    queryFn: ({ signal }) => getJson<ProviderGroup[]>("/connections", { signal }),
    // Check idle connections too: scheduled syncs and other tabs may finish
    // without this page ever seeing a running state.
    refetchInterval: (query) =>
      anySyncing(query.state.data as ProviderGroup[] | undefined) ? 2000 : 30_000,
  });
}

export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJson<ConnectionState>(`/connections/${id}/sync`, {}),
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useManageConnection() {
  return useMutation({
    mutationFn: (id: string) => postJson<ManageResp>(`/connections/${id}/manage`, {}),
  });
}

export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<SyncAllResp>("/sync", {}),
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useEnabledProviders() {
  return useQuery({
    queryKey: keys.providersEnabled(),
    queryFn: ({ signal }) => getJson<EnabledProvider[]>("/providers/enabled", { signal }),
  });
}

export function useInitConnection() {
  return useMutation({
    mutationFn: (providerKey: string) =>
      postJson<InitConnectionResp>(
        "/connections/init",
        { providerKey },
      ),
  });
}

export function useCompleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, params }: CompleteConnectionReq) =>
      postJson<void>("/connections/complete", { connectionId, params }),
    // A completed connect kicks an initial sync server-side, so the poll that
    // `afterSyncRequested` starts is what eventually refreshes the data views.
    onSuccess: () => afterSyncRequested(qc),
    onError: () => afterConnectFailed(qc),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/connections/${id}`),
    // Deleting cascades to the connection's accounts and holdings immediately,
    // so every dashboard figure changes with it — not just the list.
    onSuccess: () => afterConnectionDeleted(qc),
  });
}
