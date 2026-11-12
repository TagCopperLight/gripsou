import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { api } from "./client";
import type {
  ChangePasswordReq,
  LoginVerifyReq,
  PasskeyOptions,
  PasskeyRegisterReq,
  RedeemInviteReq,
  UpdateProfileReq,
} from "./wire";
import type { PrefsPatch } from "../lib/prefsPatch";
import { keys } from "./keys";
import { afterMfaChange, afterSessionChange, afterUserChange } from "./invalidate";
import { useAuth } from "../auth/context";

export type SecondFactor = Omit<LoginVerifyReq, "challenge">;

/** The session calls, made by the auth state and the sign-in pages outside
 *  any query: what they return becomes the signed-in user. */
export const authApi = {
  me: () => api("GET /auth/me"),
  login: (email: string, password: string, remember: boolean) =>
    api("POST /auth/login", { body: { email, password, remember } }),
  verifyLogin: (challenge: string, code: SecondFactor) =>
    api("POST /auth/login/verify", { body: { challenge, ...code } }),
  passkeyOptions: () =>
    api("POST /auth/passkey/options") as Promise<PasskeyOptions & { options: PublicKeyCredentialRequestOptionsJSON }>,
  loginWithPasskey: (challenge: string, credential: AuthenticationResponseJSON, remember: boolean) =>
    api("POST /auth/passkey", { body: { challenge, credential, remember } }),
  logout: () => api("POST /auth/logout"),
  savePrefs: (patch: PrefsPatch) => api("PATCH /auth/prefs", { body: patch }),
  finishWelcome: () => api("POST /auth/welcome"),
  tokenInfo: (token: string) => api("GET /auth/token/:token", { params: { token } }),
  redeemInvite: (token: string, body: RedeemInviteReq) =>
    api("POST /auth/invite/:token/redeem", { params: { token }, body }),
  redeemReset: (token: string, password: string) =>
    api("POST /auth/reset/:token/redeem", { params: { token }, body: { password } }),
};

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { updateUser } = useAuth();
  return useMutation({
    mutationFn: ({ name, email }: UpdateProfileReq) =>
      api("PATCH /auth/me", { body: { name, email } }),
    onSuccess: (updated) => {
      updateUser(updated);
      // The admin user list shows the current user's name/email too.
      void afterUserChange(qc);
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: ChangePasswordReq) =>
      api("POST /auth/change-password", { body: { currentPassword, newPassword } }),
    onSuccess: () => {
      // Changing the password revokes all other sessions server-side; refresh
      // the sessions list so stale entries disappear immediately.
      afterSessionChange(qc);
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    // The password is checked server-side (throttled like login) before the
    // account and all its data are permanently deleted.
    mutationFn: (password: string) => api("DELETE /auth/account", { body: { password } }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions(),
    queryFn: ({ signal }) => api("GET /auth/sessions", { signal }),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /auth/sessions/:id", { params: { id } }),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("DELETE /auth/sessions"),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useMfaStatus() {
  return useQuery({
    queryKey: keys.mfaStatus(),
    queryFn: ({ signal }) => api("GET /auth/mfa/status", { signal }),
  });
}

export function useReauth() {
  return useMutation({
    mutationFn: (password: string) =>
      api("POST /auth/reauth", { body: { password } }),
  });
}

/** Starts setting up an authenticator. No password check (`reauth`) during
 *  the welcome flow. */
export function useTotpSetup() {
  return useMutation({
    mutationFn: (reauth: string | undefined) =>
      api("POST /auth/mfa/totp/setup", { body: { reauth } }),
  });
}

export function useTotpConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api("POST /auth/mfa/totp/confirm", { body: { code } }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRemoveTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reauth: string) =>
      api("DELETE /auth/mfa/totp", { body: { reauth } }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRegenerateRecovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reauth: string) =>
      api("POST /auth/mfa/recovery/regenerate", { body: { reauth } }),
    onSuccess: () => afterMfaChange(qc),
  });
}

/** Starts adding a passkey: the browser's creation options for a fresh
 *  password check (the token is checked, not spent, so a cancelled browser
 *  window can be retried), or for none during the welcome flow. */
export function usePasskeyRegisterOptions() {
  return useMutation({
    mutationFn: (reauth: string | undefined) =>
      api("POST /auth/mfa/passkeys/register/options", { body: { reauth } }) as Promise<
        PasskeyOptions & { options: PublicKeyCredentialCreationOptionsJSON }
      >,
  });
}

export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PasskeyRegisterReq & { credential: RegistrationResponseJSON }) =>
      api("POST /auth/mfa/passkeys/register", { body }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRenamePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api("PATCH /auth/mfa/passkeys/:id", { params: { id }, body: { name } }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE /auth/mfa/passkeys/:id", { params: { id } }),
    onSuccess: () => afterMfaChange(qc),
  });
}
