import { useCallback, useMemo, useState, type ReactNode } from "react";
import { postJson, setAuthToken } from "../api/client";
import type { SessionUser } from "../api/types";
import { AuthContext, type AuthValue } from "./context";

type LoginResponse = { token: string; user: SessionUser };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const res = await postJson<LoginResponse>("/auth/login", { email, password });
    setAuthToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ isAuthenticated: user !== null, user, login, logout }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
