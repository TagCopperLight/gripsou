import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";

import { ApiError } from "../api/client";
import { useReauth } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";

/** The password check before a sensitive change. `check()` trades the password
 *  for a reauth token, or shows why it can't (throttled, wrong password, or
 *  a failure of the check itself, in the corner) and returns null. The error line is the modal's to reuse. */
export function useReauthStep() {
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
      // Throttled or a wrong password: the user's to fix, next to the field.
      // Anything else failed on the server's side.
      if (minutes !== null) setError(t("auth.tooManyAttempts", { count: minutes }));
      else if (err instanceof ApiError && err.status === 400) setError(t("twoFactor.wrongPassword"));
      else showError(t("auth.reauthFailed"));
      return null;
    }
  };

  return { password, setPassword, error, setError, checking: reauth.isPending, check };
}
