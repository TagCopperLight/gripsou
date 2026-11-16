import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";

import { useReauth } from "../api/auth";
import { passwordError } from "./throttle";

/** `check()` returns null after showing why it failed. The error line is the modal's to reuse. */
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
      // Throttled or a wrong password is the user's to fix.
      const typed = passwordError(t, err);
      if (typed) setError(typed);
      else showError(t("auth.reauthFailed"));
      return null;
    }
  };

  const typePassword = (value: string) => {
    setPassword(value);
    setError(null);
  };

  return { password, setPassword: typePassword, error, setError, checking: reauth.isPending, check };
}
