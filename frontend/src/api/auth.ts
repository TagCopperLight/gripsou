import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { deleteJson, getJson, patchJson, postJson } from "./client";
import type {
  ChangePasswordReq,
  LoginOutcome,
  LoginVerifyReq,
  MfaStatus,
  Passkey,
  PasskeyOptions,
  PasskeyRegisterReq,
  ReauthResponse,
  RecoveryCodes,
  RedeemInviteReq,
  Session,
  SessionResponse,
  SessionUser,
  TokenInfo,
  TotpSetup,
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
  me: () => getJson<SessionUser>("/auth/me"),
  login: (email: string, password: string, remember: boolean) =>
    postJson<LoginOutcome>("/auth/login", { email, password, remember }),
  verifyLogin: (challenge: string, code: SecondFactor) =>
    postJson<SessionResponse>("/auth/login/verify", { challenge, ...code }),
  passkeyOptions: () =>
    postJson<PasskeyOptions & { options: PublicKeyCredentialRequestOptionsJSON }>("/auth/passkey/options", {}),
  loginWithPasskey: (challenge: string, credential: AuthenticationResponseJSON, remember: boolean) =>
    postJson<SessionResponse>("/auth/passkey", { challenge, credential, remember }),
  logout: () => postJson<void>("/auth/logout", {}),
  savePrefs: (patch: PrefsPatch) => patchJson<SessionUser>("/auth/prefs", patch),
  finishWelcome: () => postJson<void>("/auth/welcome", {}),
  tokenInfo: (token: string) => getJson<TokenInfo>(`/auth/token/${token}`),
  redeemInvite: (token: string, body: RedeemInviteReq) =>
    postJson<SessionResponse>(`/auth/invite/${token}/redeem`, body),
  redeemReset: (token: string, password: string) =>
    postJson<SessionResponse>(`/auth/reset/${token}/redeem`, { password }),
};

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { updateUser } = useAuth();
  return useMutation({
    mutationFn: ({ name, email }: UpdateProfileReq) =>
      patchJson<SessionUser>("/auth/me", { name, email }),
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
      postJson<void>("/auth/change-password", { currentPassword, newPassword }),
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
    mutationFn: (password: string) => deleteJson<void>("/auth/account", { password }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions(),
    queryFn: ({ signal }) => getJson<Session[]>("/auth/sessions", { signal }),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/auth/sessions/${id}`),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteJson<void>("/auth/sessions"),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useMfaStatus() {
  return useQuery({
    queryKey: keys.mfaStatus(),
    queryFn: ({ signal }) => getJson<MfaStatus>("/auth/mfa/status", { signal }),
  });
}

export function useReauth() {
  return useMutation({
    mutationFn: (password: string) =>
      postJson<ReauthResponse>("/auth/reauth", { password }),
  });
}

export function useTotpSetup() {
  return useMutation({
    mutationFn: (reauth: string) =>
      postJson<TotpSetup>("/auth/mfa/totp/setup", { reauth }),
  });
}

export function useTotpConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      postJson<RecoveryCodes>("/auth/mfa/totp/confirm", { code }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRemoveTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reauth: string) =>
      deleteJson<void>("/auth/mfa/totp", { reauth }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRegenerateRecovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reauth: string) =>
      postJson<RecoveryCodes>(
        "/auth/mfa/recovery/regenerate",
        { reauth },
      ),
    onSuccess: () => afterMfaChange(qc),
  });
}

/** Starts adding a passkey: the browser's creation options for a fresh
 *  password check (the token is checked, not spent, so a cancelled browser
 *  window can be retried). */
export function usePasskeyRegisterOptions() {
  return useMutation({
    mutationFn: (reauth: string) =>
      postJson<PasskeyOptions & { options: PublicKeyCredentialCreationOptionsJSON }>(
        "/auth/mfa/passkeys/register/options",
        { reauth },
      ),
  });
}

export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PasskeyRegisterReq & { credential: RegistrationResponseJSON }) =>
      postJson<Passkey>("/auth/mfa/passkeys/register", body),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useRenamePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      patchJson<void>(`/auth/mfa/passkeys/${id}`, { name }),
    onSuccess: () => afterMfaChange(qc),
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/auth/mfa/passkeys/${id}`),
    onSuccess: () => afterMfaChange(qc),
  });
}
