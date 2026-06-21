import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getJson } from "../api/client";

export type TokenInfo = { type: "invite" | "reset"; email: string | null };

type Guard = { status: "loading" | "valid"; info: TokenInfo | null };

/**
 * Validate an invite/reset token on mount. Any failure (404, network, …) sends
 * the user to `/` — the page renders nothing until then, so an invalid token is
 * never shown a form. `skipGlobalUnauthorized` avoids the app-wide 401 handler.
 */
export function useTokenGuard(token: string): Guard {
  const navigate = useNavigate();
  const [guard, setGuard] = useState<Guard>({ status: "loading", info: null });

  useEffect(() => {
    let active = true;
    getJson<TokenInfo>(`/auth/token/${token}`, { skipGlobalUnauthorized: true })
      .then((info) => {
        if (active) setGuard({ status: "valid", info });
      })
      .catch(() => {
        if (active) void navigate({ to: "/" });
      });
    return () => {
      active = false;
    };
  }, [token, navigate]);

  return guard;
}
