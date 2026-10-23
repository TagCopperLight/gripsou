import { createContext, useContext } from "react";
import type { MfaRequired, SessionUser } from "../api/types";

import type { PrefsPatch, UserPrefs } from "../lib/prefs";

export type SecondFactor = { totp: string } | { recoveryCode: string };

export type AuthValue = {
  isAuthenticated: boolean;
  user: SessionUser | null;
  isBootstrapping: boolean;
  /** Current user's prefs, or defaults when logged out. */
  prefs: UserPrefs;
  /** `null` once signed in; the challenge when a second step is needed (nothing stored). */
  login: (email: string, password: string, remember: boolean) => Promise<MfaRequired | null>;
  /** Sign in with a passkey alone: asks the browser, then signs in. Throws
   *  when the browser's window is cancelled or the server refuses it. */
  loginWithPasskey: (remember: boolean) => Promise<void>;
  /** Finish a two-factor sign-in with an authenticator code, a backup code
   *  or a passkey's answer. */
  verifyLogin: (
    challenge: string,
    code: SecondFactor,
    remember: boolean,
  ) => Promise<void>;
  /** Adopt a session returned by invite/reset redemption (auto-login). */
  adoptSession: (token: string, user: SessionUser) => void;
  logout: () => Promise<void>;
  /** Replace the cached profile after the user edits their own account. */
  updateUser: (user: SessionUser) => void;
  /** Show the changed settings at once and save them (PATCH /auth/prefs).
   *  Rejects when the save fails; the stored prefs are then shown again. */
  updatePrefs: (patch: PrefsPatch) => Promise<void>;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
