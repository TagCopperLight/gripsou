import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAuthToken, getJson, patchJson, postJson, setAuthToken } from "../api/client";
import type { SessionUser } from "../api/types";
import { AuthContext, type AuthValue } from "./context";
import i18n from "../i18n";
import { DEFAULT_PREFS, setPrefs, type UserPrefs } from "../lib/prefs";

type LoginResponse = { token: string; user: SessionUser };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  // Apply a user's prefs everywhere: the formatter singleton + i18n language.
  const applyUser = useCallback((u: SessionUser) => {
    setUser(u);
    setPrefs(u.prefs);
    if (i18n.language !== u.prefs.uiLanguage) void i18n.changeLanguage(u.prefs.uiLanguage);
  }, []);

  // On load, a persisted token means "stay logged in": validate it via /auth/me.
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!getAuthToken()) {
        if (active) setIsBootstrapping(false);
        return;
      }
      try {
        // A 401 here is expected (stale/invalid stored token) and must NOT
        // trigger the global unauthorized handler (which would fire a spurious
        // POST /auth/logout and navigate before isBootstrapping resolves).
        const u = await getJson<SessionUser>("/auth/me", { skipGlobalUnauthorized: true });
        if (active) applyUser(u);
      } catch (err: unknown) {
        // A 401 here is expected (stale/invalid stored token) and must NOT
        // trigger the global unauthorized handler (which would fire a spurious
        // POST /auth/logout and navigate before isBootstrapping resolves).
        // Only clear the stored token if it's explicitly rejected as unauthorized.
        // Network errors or 50x shouldn't log the user out.
        if (err instanceof Error && err.message.includes("unauthorized")) {
          setAuthToken(null);
        }
      } finally {
        if (active) setIsBootstrapping(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [applyUser]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await postJson<LoginResponse>(
        "/auth/login",
        { email, password, remember },
        { skipGlobalUnauthorized: true },
      );
      setAuthToken(res.token, remember);
      applyUser(res.user);
    },
    [applyUser],
  );

  const logout = useCallback(async () => {
    try {
      await postJson<void>("/auth/logout", {}, { skipGlobalUnauthorized: true });
    } catch {
      // Token may already be invalid/expired; clear locally regardless.
    }
    setAuthToken(null);
    setUser(null);
    setPrefs(DEFAULT_PREFS);
  }, []);

  const updateUser = useCallback((next: SessionUser) => setUser(next), []);

  const updatePrefs = useCallback(
    async (next: UserPrefs) => {
      const prev = user;
      // Optimistic: apply immediately so the UI (and live preview) feels instant.
      setUser((u) => (u ? { ...u, prefs: next } : u));
      setPrefs(next);
      if (i18n.language !== next.uiLanguage) void i18n.changeLanguage(next.uiLanguage);
      try {
        const updated = await patchJson<SessionUser>("/auth/prefs", next);
        setUser(updated);
        setPrefs(updated.prefs);
      } catch (e) {
        // Revert to the last known-good prefs on failure.
        if (prev) {
          setUser(prev);
          setPrefs(prev.prefs);
          if (i18n.language !== prev.prefs.uiLanguage)
            void i18n.changeLanguage(prev.prefs.uiLanguage);
        }
        throw e;
      }
    },
    [user],
  );

  const value = useMemo<AuthValue>(
    () => ({
      isAuthenticated: user !== null,
      user,
      isBootstrapping,
      prefs: user?.prefs ?? DEFAULT_PREFS,
      login,
      logout,
      updateUser,
      updatePrefs,
    }),
    [user, isBootstrapping, login, logout, updateUser, updatePrefs],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
