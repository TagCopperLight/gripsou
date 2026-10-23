import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, getAuthToken, getJson, patchJson, postJson, setAuthToken } from "../api/client";
import type { MfaRequired, SessionUser } from "../api/types";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { AuthContext, type AuthValue, type SecondFactor } from "./context";
import i18n from "../i18n";
import { DEFAULT_PREFS, setPrefs, withPatch, type PrefsPatch } from "../lib/prefs";
import { afterCategorizeRequested, afterReviewThresholdChange } from "../api/invalidate";
import { queryClient } from "../queryClient";

type SessionResponse = { token: string; user: SessionUser };
type LoginResponse = SessionResponse | MfaRequired;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  // The user as shown, readable by two saves made in the same tick.
  const shown = useRef<SessionUser | null>(null);
  const prefsSaves = useRef<Promise<unknown>>(Promise.resolve());

  const resetSession = useCallback(() => {
    shown.current = null;
    queryClient.clear();
  }, []);

  // Apply a user's prefs everywhere: the formatter singleton + i18n language.
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
        const u = await getJson<SessionUser>("/auth/me");
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
      const res = await postJson<LoginResponse>(
        "/auth/login",
        { email, password, remember },
      );
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
      const { challenge, options } = await postJson<{
        challenge: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>("/auth/passkey/options", {});
      const credential = await startAuthentication({ optionsJSON: options });
      const res = await postJson<SessionResponse>(
        "/auth/passkey",
        { challenge, credential, remember },
      );
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
      const res = await postJson<SessionResponse>(
        "/auth/login/verify",
        { challenge, ...code },
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
    const request = postJson<void>("/auth/logout", {});
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
      const stored = await getJson<SessionUser>("/auth/me");
      if (shown.current) applyUser({ ...shown.current, prefs: stored.prefs });
    } catch {
      // Offline or signed out: the next load shows the stored prefs.
    }
  }, [applyUser]);

  const updatePrefs = useCallback(
    async (patch: PrefsPatch) => {
      const u = shown.current;
      if (!u) return;
      applyUser({ ...u, prefs: withPatch(u.prefs, patch) });
      // One save at a time, so two changes of one setting are stored in order.
      const save = prefsSaves.current.then(() => patchJson<SessionUser>("/auth/prefs", patch));
      prefsSaves.current = save.catch(() => {});
      try {
        await save;
      } catch (err) {
        // Show what is stored, once the saves queued behind this one are in.
        prefsSaves.current = prefsSaves.current.then(showStoredPrefs);
        throw err;
      }
      if ("currency" in patch || "timeZone" in patch) {
        await queryClient.cancelQueries();
        await queryClient.invalidateQueries();
      } else if ("budgetAiThreshold" in patch) {
        await afterReviewThresholdChange(queryClient);
      }
      if ("budgetAiEnabled" in patch) await afterCategorizeRequested(queryClient);
    },
    [applyUser, showStoredPrefs],
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
