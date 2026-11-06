import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Provider, Role } from "./wire";
import { keys } from "./keys";
import { afterApiKeyChange, afterProviderChange, afterUserChange } from "./invalidate";

export function useUsers() {
  return useQuery({
    queryKey: keys.users(),
    queryFn: ({ signal }) => api("GET /users", { signal }),
  });
}

export function useCreateInvite() {
  return useMutation({
    mutationFn: () => api("POST /invites"),
  });
}

export function useCreateResetLink() {
  return useMutation({
    mutationFn: ({ id, reauth }: { id: string; reauth: string }) =>
      api("POST /users/:id/reset-link", { params: { id }, body: { reauth } }),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api("PATCH /users/:id", { params: { id }, body: { role } }),
    onSuccess: () => afterUserChange(qc),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      api("DELETE /users/:id", { params: { id }, body: { email } }),
    onSuccess: () => afterUserChange(qc),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers(),
    queryFn: ({ signal }) => api("GET /providers", { signal }),
  });
}

export function useSetProviderEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api("PATCH /providers/:key", { params: { key }, body: { enabled } }),
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
    queryFn: ({ signal }) => api("GET /settings/api-keys", { signal }),
  });
}

/** Saves one field; `value` null removes it. */
export function useSetApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, field, value }: { provider: string; field: string; value: string | null }) =>
      api("PATCH /settings/api-keys/:provider", { params: { provider }, body: { field, value } }),
    onSettled: () => afterApiKeyChange(qc),
  });
}
