import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, getAuthToken, setAuthToken } from "../api/client";
import { authApi, type SecondFactor } from "../api/auth";
import type { SessionUser } from "../api/wire";
import { startAuthentication } from "@simplewebauthn/browser";
import { AuthContext, isCurrencyRefused, type AuthValue } from "./context";
import i18n from "../i18n";
import { showError } from "../lib/errorToasts";
import { setPrefs } from "../lib/prefs";
import { withPatch, type PrefsPatch } from "../lib/prefsPatch";
import { DEFAULT_PREFS } from "../api/wire";
import { afterPrefsSaved } from "../api/invalidate";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  // The user as shown, readable by two saves made in the same tick.
  const shown = useRef<SessionUser | null>(null);
  const prefsSaves = useRef<Promise<unknown>>(Promise.resolve());

  const resetSession = useCallback(() => {
    shown.current = null;
    queryClient.clear();
  }, [queryClient]);

  // Apply a user's prefs everywhere: the formatters' default + i18n language.
  const applyUser = useCallback((u: SessionUser) => {
    shown.current = u;
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
        const u = await authApi.me();
        if (active) applyUser(u);
      } catch (err: unknown) {
        // Only a rejected token is cleared: network errors or 50x shouldn't log the user out.
        if (err instanceof ApiError && err.status === 401) {
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
      setAuthToken(token, true); // redemption keeps you signed in (persisted).
      applyUser(user);
    },
    [applyUser, resetSession],
  );

  const logout = useCallback(async () => {
    // Capture the old token in the logout request, then clear locally at once:
    // a slow or failed request must not keep another user's cache alive.
    const request = authApi.logout();
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

  // A profile response carries the prefs as they were stored; keep the shown
  // ones, which may include a save still on its way.
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
      // A new currency waits for the server, which first fetches its rate and
      // may refuse it: shown early, it would put its symbol on figures still
      // in the old one.
      const waits = "currency" in patch;
      if (!waits) applyUser({ ...u, prefs: withPatch(u.prefs, patch) });
      // One save at a time, so two changes of one setting are stored in order.
      const save = prefsSaves.current.then(() => authApi.savePrefs(patch));
      prefsSaves.current = save.catch(() => {});
      try {
        await save;
      } catch (err) {
        // Show what is stored, once the saves queued behind this one are in;
        // then say so in the corner, in the language shown again. A refused
        // currency (no rate to be had) is explained next to its field instead.
        const refused = waits && isCurrencyRefused(err);
        prefsSaves.current = prefsSaves.current.then(showStoredPrefs).then(() => {
          if (!refused) showError(i18n.t("settings.prefSaveFailed"));
        });
        // Only a currency's caller waits on the answer; the others are told above.
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
