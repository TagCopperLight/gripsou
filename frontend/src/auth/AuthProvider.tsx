import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, getAuthToken, sessionCheckDone, setAuthToken } from "../api/client";
import { authApi, type SecondFactor } from "../api/auth";
import type { SessionUser } from "../api/wire";
import { startAuthentication } from "@simplewebauthn/browser";
import { AuthContext, isCurrencyRefused, type AuthValue } from "./context";
import i18n from "../i18n";
import { saveLanguage } from "../i18n/savedLanguage";
import { showError } from "../lib/errorToasts";
import { setPrefs } from "../lib/prefs";
import { withPatch, type PrefsPatch } from "../lib/prefsPatch";
import { DEFAULT_PREFS } from "../api/wire";
import { afterPrefsSaved } from "../api/invalidate";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(() => getAuthToken() !== null);
  // Readable by two saves made in the same tick.
  const shown = useRef<SessionUser | null>(null);
  const prefsSaves = useRef<Promise<unknown>>(Promise.resolve());

  const resetSession = useCallback(() => {
    shown.current = null;
    queryClient.clear();
  }, [queryClient]);

  const applyUser = useCallback((u: SessionUser) => {
    shown.current = u;
    setUser(u);
    setPrefs(u.prefs);
    saveLanguage(u.prefs.uiLanguage);
    if (i18n.language !== u.prefs.uiLanguage) void i18n.changeLanguage(u.prefs.uiLanguage);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!getAuthToken()) return;
      try {
        const u = await authApi.me();
        if (active) applyUser(u);
      } catch (err: unknown) {
        // Only a rejected token is cleared: network errors or 50x shouldn't log the user out.
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
          sessionCheckDone();
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [applyUser]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await authApi.login(email, password, remember);
      if ("mfaRequired" in res) return res;
      resetSession();
      setAuthToken(res.token, remember);
      applyUser(res.user);
      return null;
    },
    [applyUser, resetSession],
  );

  const loginWithPasskey = useCallback(
    async (remember: boolean) => {
      const { challenge, options } = await authApi.passkeyOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      const res = await authApi.loginWithPasskey(challenge, credential, remember);
      resetSession();
      setAuthToken(res.token, remember);
      applyUser(res.user);
    },
    [applyUser, resetSession],
  );

  const verifyLogin = useCallback(
    async (
      challenge: string,
      code: SecondFactor,
      remember: boolean,
    ) => {
      const res = await authApi.verifyLogin(challenge, code);
      resetSession();
      setAuthToken(res.token, remember);
      applyUser(res.user);
    },
    [applyUser, resetSession],
  );

  const adoptSession = useCallback(
    (token: string, user: SessionUser) => {
      resetSession();
      setAuthToken(token, true);
      applyUser(user);
    },
    [applyUser, resetSession],
  );

  const logout = useCallback(async () => {
    // Clear locally at once: a slow or failed request must not keep another user's cache alive.
    const request = authApi.logout();
    setAuthToken(null);
    resetSession();
    setUser(null);
    setPrefs(DEFAULT_PREFS);
    try {
      await request;
    } catch {
      // The token may already be invalid; sign out locally anyway.
    }
  }, [resetSession]);

  // The profile response carries stored prefs; keep the shown ones, which may include a save on its way.
  const updateUser = useCallback(
    (next: SessionUser) => {
      if (shown.current) applyUser({ ...next, prefs: shown.current.prefs });
    },
    [applyUser],
  );

  const showStoredPrefs = useCallback(async () => {
    try {
      const stored = await authApi.me();
      if (shown.current) applyUser({ ...shown.current, prefs: stored.prefs });
    } catch {
      // Offline or signed out: the next load shows the stored prefs.
    }
  }, [applyUser]);

  const updatePrefs = useCallback(
    async (patch: PrefsPatch) => {
      const u = shown.current;
      if (!u) return;
      // A new currency waits for the server, which may refuse it: shown early, its symbol would sit on figures still in the old one.
      const waits = "currency" in patch;
      if (!waits) applyUser({ ...u, prefs: withPatch(u.prefs, patch) });
      const save = prefsSaves.current.then(() => authApi.savePrefs(patch));
      prefsSaves.current = save.catch(() => {});
      try {
        await save;
      } catch (err) {
        // A refused currency is explained next to its field instead.
        const refused = waits && isCurrencyRefused(err);
        prefsSaves.current = prefsSaves.current.then(showStoredPrefs).then(() => {
          if (!refused) showError(i18n.t("settings.prefSaveFailed"));
        });
        if (waits) throw err;
        return;
      }
      if (waits && shown.current) {
        applyUser({ ...shown.current, prefs: withPatch(shown.current.prefs, patch) });
      }
      await afterPrefsSaved(queryClient, patch);
    },
    [applyUser, showStoredPrefs, queryClient],
  );

  const value = useMemo<AuthValue>(
    () => ({
      isAuthenticated: user !== null,
      user,
      isBootstrapping,
      prefs: user?.prefs ?? DEFAULT_PREFS,
      login,
      loginWithPasskey,
      verifyLogin,
      adoptSession,
      logout,
      updateUser,
      updatePrefs,
    }),
    [user, isBootstrapping, login, loginWithPasskey, verifyLogin, adoptSession, logout, updateUser, updatePrefs],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
