import { createContext, useContext } from "react";
import type { SessionUser } from "../api/types";
import type { UserPrefs } from "../lib/prefs";

export type AuthValue = {
  isAuthenticated: boolean;
  user: SessionUser | null;
  isBootstrapping: boolean;
  /** Current user's prefs, or defaults when logged out. */
  prefs: UserPrefs;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
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
