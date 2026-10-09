import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAuthToken, getJson, patchJson, postJson, setAuthToken } from "../api/client";
import type { SessionUser } from "../api/types";
import { AuthContext, type AuthValue } from "./context";
import i18n from "../i18n";
import { DEFAULT_PREFS, setPrefs, type UserPrefs } from "../lib/prefs";
import { afterCategorizeRequested, afterReviewThresholdChange } from "../api/invalidate";
import { queryClient } from "../queryClient";

type LoginResponse = { token: string; user: SessionUser };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const savedUser = useRef<SessionUser | null>(null);
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve());
  const preferenceRequest = useRef(0);

  const resetSession = useCallback(() => {
    preferenceQueue.current = Promise.resolve();
    preferenceRequest.current++;
    savedUser.current = null;
    queryClient.clear();
  }, []);

  // Apply a user's prefs everywhere: the formatter singleton + i18n language.
  const applyUser = useCallback((u: SessionUser) => {
    savedUser.current = u;
    setUser(u);
    setPrefs(u.prefs);
    if (i18n.language !== u.prefs.uiLanguage) void i18n.changeLanguage(u.prefs.uiLanguage);
  }, []);

  // On load, a persisted token means "stay logged in": validate it via /auth/me.
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const token = getAuthToken();
      if (!token) {
        if (active) setIsBootstrapping(false);
        return;
      }
      try {
        // A 401 here is expected (stale/invalid stored token) and must NOT
        // trigger the global unauthorized handler (which would fire a spurious
        // POST /auth/logout and navigate before isBootstrapping resolves).
        const u = await getJson<SessionUser>("/auth/me", { skipGlobalUnauthorized: true });
        if (active && token === getAuthToken()) applyUser(u);
      } catch (err: unknown) {
        // A 401 here is expected (stale/invalid stored token) and must NOT
        // trigger the global unauthorized handler (which would fire a spurious
        // POST /auth/logout and navigate before isBootstrapping resolves).
        // Only clear the stored token if it's explicitly rejected as unauthorized.
        // Network errors or 50x shouldn't log the user out.
        if (token === getAuthToken() && err instanceof Error && err.message.includes("unauthorized")) {
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
      resetSession();
      setAuthToken(res.token, remember);
      applyUser(res.user);
    },
    [applyUser, resetSession],
  );

  const adoptSession = useCallback(
    (token: string, user: SessionUser) => {
      resetSession();
      setAuthToken(token, true); // redemption keeps you signed in (persisted).
      applyUser(user);
    },
    [applyUser, resetSession],
  );

  const logout = useCallback(async () => {
    // Capture the old token in the logout request, then clear locally at once:
    // a slow or failed request must not keep another user's cache alive.
    const request = postJson<void>("/auth/logout", {}, { skipGlobalUnauthorized: true });
    setAuthToken(null);
    resetSession();
    setUser(null);
    setPrefs(DEFAULT_PREFS);
    try {
      await request;
    } catch {
      // Token may already be invalid/expired; clear locally regardless.
    }
  }, [resetSession]);

  const updateUser = useCallback((next: SessionUser) => {
    if (savedUser.current?.id !== next.id) return;
    // A profile response updates identity fields, not a later preference save.
    savedUser.current = { ...next, prefs: savedUser.current.prefs };
    setUser((current) => current ? { ...next, prefs: current.prefs } : null);
  }, []);

  const updatePrefs = useCallback(
    (next: UserPrefs) => {
      const token = getAuthToken();
      const requestId = ++preferenceRequest.current;
      // Keep controls responsive while full preference writes are serialized.
      setUser((u) => (u ? { ...u, prefs: next } : u));
      setPrefs(next);
      if (i18n.language !== next.uiLanguage) void i18n.changeLanguage(next.uiLanguage);

      const request = preferenceQueue.current.then(async () => {
        if (token !== getAuthToken()) return;
        try {
          const updated = await patchJson<SessionUser>("/auth/prefs", next);
          if (token !== getAuthToken()) return;
          const prev = savedUser.current;
          const acknowledged = prev ? { ...prev, prefs: updated.prefs } : updated;
          savedUser.current = acknowledged;
          // Keep later profile edits and optimistic preference choices.
          if (requestId === preferenceRequest.current) applyUser(acknowledged);
          const refreshes: Promise<unknown>[] = [];
          if (updated.prefs.timeZone !== prev?.prefs.timeZone || updated.prefs.currency !== prev?.prefs.currency) {
            refreshes.push(queryClient.cancelQueries().then(() => {
              if (token === getAuthToken()) return queryClient.invalidateQueries();
            }));
          } else if (updated.prefs.budgetAiThreshold !== prev?.prefs.budgetAiThreshold) {
            refreshes.push(afterReviewThresholdChange(queryClient));
          }
          if (updated.prefs.budgetAiEnabled !== prev?.prefs.budgetAiEnabled)
            refreshes.push(afterCategorizeRequested(queryClient));
          return { refreshed: Promise.all(refreshes) };
        } catch (error) {
          if (token === getAuthToken() && requestId === preferenceRequest.current && savedUser.current)
            applyUser(savedUser.current);
          throw error;
        }
      });
      // Serialize writes, not the potentially slow chart/table reads that
      // follow them. A rejected save must not block the next queued save.
      preferenceQueue.current = request.then(() => {}, () => {});
      return request.then((saved) => saved?.refreshed).then(() => {});
    },
    [applyUser],
  );

  const value = useMemo<AuthValue>(
    () => ({
      isAuthenticated: user !== null,
      user,
      isBootstrapping,
      prefs: user?.prefs ?? DEFAULT_PREFS,
      login,
      adoptSession,
      logout,
      updateUser,
      updatePrefs,
    }),
    [user, isBootstrapping, login, adoptSession, logout, updateUser, updatePrefs],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
