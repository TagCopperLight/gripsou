import { createContext, useContext } from "react";
import type { SessionUser } from "../api/types";

export type AuthValue = {
  isAuthenticated: boolean;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
