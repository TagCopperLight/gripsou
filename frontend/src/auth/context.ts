import { createContext, useContext } from "react";
import type { MfaRequired, SessionUser } from "../api/types";
import type { UserPrefs } from "../lib/prefs";

export type AuthValue = {
  isAuthenticated: boolean;
  user: SessionUser | null;
  isBootstrapping: boolean;
  /** Current user's prefs, or defaults when logged out. */
  prefs: UserPrefs;
  /** `null` once signed in; the challenge when a second step is needed (nothing stored). */
  login: (email: string, password: string, remember: boolean) => Promise<MfaRequired | null>;
  /** Finish a two-factor sign-in with an authenticator or backup code. */
  verifyLogin: (
    challenge: string,
    code: { totp: string } | { recoveryCode: string },
    remember: boolean,
  ) => Promise<void>;
  /** Adopt a session returned by invite/reset redemption (auto-login). */
  adoptSession: (token: string, user: SessionUser) => void;
  logout: () => Promise<void>;
  /** Replace the cached profile after the user edits their own account. */
  updateUser: (user: SessionUser) => void;
  /** Persist new prefs (PATCH /auth/prefs), applying them app-wide. */
  updatePrefs: (next: UserPrefs) => Promise<void>;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
