import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAuthToken, getJson, postJson, setAuthToken } from "../api/client";
import type { SessionUser } from "../api/types";
import { AuthContext, type AuthValue } from "./context";

type LoginResponse = { token: string; user: SessionUser };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

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
        if (active) setUser(u);
      } catch {
        setAuthToken(null);
      } finally {
        if (active) setIsBootstrapping(false);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await postJson<LoginResponse>("/auth/login", {
        email,
        password,
        remember,
      });
      setAuthToken(res.token, remember);
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await postJson<void>("/auth/logout", {});
    } catch {
      // Token may already be invalid/expired; clear locally regardless.
    }
    setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      isAuthenticated: user !== null,
      user,
      isBootstrapping,
      login,
      logout,
    }),
    [user, isBootstrapping, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
