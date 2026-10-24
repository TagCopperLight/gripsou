import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../api/client";
import { useReauth } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";

/** The password check before a sensitive change. `check()` trades the password
 *  for a reauth token, or shows why it can't (throttled, wrong password, or
 *  `failed`) and returns null. The error line is the modal's to reuse. */
export function useReauthStep(failed: string) {
  const { t } = useTranslation();
  const reauth = useReauth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const check = async (): Promise<string | null> => {
    setError(null);
    try {
      return (await reauth.mutateAsync(password)).reauth;
    } catch (err) {
      const minutes = throttleMinutes(err);
      setError(
        minutes !== null
          ? t("auth.tooManyAttempts", { count: minutes })
          : err instanceof ApiError && err.status === 400
            ? t("twoFactor.wrongPassword")
            : failed,
      );
      return null;
    }
  };

  return { password, setPassword, error, setError, checking: reauth.isPending, check };
}
