import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import type { TokenInfo } from "../api/wire";

type Guard = { status: "loading" | "valid"; info: TokenInfo | null };

/** Any failure sends the user to `/`; until the token is valid the form stays off. */
export function useTokenGuard(token: string): Guard {
  const navigate = useNavigate();
  const [guard, setGuard] = useState<Guard>({ status: "loading", info: null });

  useEffect(() => {
    let active = true;
    authApi.tokenInfo(token)
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
