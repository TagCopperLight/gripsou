import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteJson, getJson, patchJson, postJson } from "./client";
import type { ApiKeyProvider, InviteLinkResp, Provider, Role, User } from "./wire";
import { keys } from "./keys";
import { afterApiKeyChange, afterProviderChange, afterUserChange } from "./invalidate";

export function useUsers() {
  return useQuery({
    queryKey: keys.users(),
    queryFn: ({ signal }) => getJson<User[]>(`/users`, { signal }),
  });
}

export function useCreateInvite() {
  return useMutation({
    mutationFn: () => postJson<InviteLinkResp>("/invites", {}),
  });
}

export function useCreateResetLink() {
  return useMutation({
    mutationFn: ({ id, reauth }: { id: string; reauth: string }) =>
      postJson<InviteLinkResp>(`/users/${id}/reset-link`, { reauth }),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      patchJson<void>(`/users/${id}`, { role }),
    onSuccess: () => afterUserChange(qc),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      deleteJson<void>(`/users/${id}`, { email }),
    onSuccess: () => afterUserChange(qc),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers(),
    queryFn: ({ signal }) => getJson<Provider[]>("/providers", { signal }),
  });
}

export function useSetProviderEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      patchJson<Provider>(`/providers/${key}`, { enabled }),
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: keys.providers() });
      const prev = qc.getQueryData<Provider[]>(keys.providers());
      qc.setQueryData<Provider[]>(keys.providers(), (old) =>
        old?.map((p) => (p.key === key ? { ...p, enabled } : p)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.providers(), ctx.prev);
    },
    onSettled: () => afterProviderChange(qc),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: keys.apiKeys(),
    queryFn: ({ signal }) => getJson<ApiKeyProvider[]>("/settings/api-keys", { signal }),
  });
}

/** Saves one field; `value` null removes it. */
export function useSetApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, field, value }: { provider: string; field: string; value: string | null }) =>
      patchJson<ApiKeyProvider>(`/settings/api-keys/${provider}`, { field, value }),
    onSettled: () => afterApiKeyChange(qc),
  });
}
