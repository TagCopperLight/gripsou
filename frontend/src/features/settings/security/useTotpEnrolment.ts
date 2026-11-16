import { useState } from "react";
import { useTranslation } from "react-i18next";

import { showError } from "../../../lib/errorToasts";
import { ApiError } from "../../../api/client";
import { useTotpConfirm, useTotpSetup } from "../../../api/auth";
import { TOTP_DIGITS, type TotpSetup } from "../../../api/wire";
import { throttledError } from "../../../auth/throttle";

export type TotpState =
  | { step: "scan"; setup: TotpSetup }
  | { step: "code"; setup: TotpSetup }
  | { step: "codes"; recoveryCodes: string[] };

/** `state` is null until `begin`, and again after the setup expires (10 minutes) and `onExpired` runs. */
export function useTotpEnrolment(onExpired: () => void) {
  const { t } = useTranslation();
  const start = useTotpSetup();
  const confirm = useTotpConfirm();
  const [state, setState] = useState<TotpState | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const begin = async (reauth?: string) => {
    try {
      const setup = await start.mutateAsync(reauth);
      setCode("");
      setError(null);
      setState({ step: "scan", setup });
    } catch {
      showError(t("twoFactor.setupFailed"));
    }
  };

  const submitCode = async (value: string) => {
    if (value.length !== TOTP_DIGITS || confirm.isPending) return;
    setError(null);
    try {
      setState({ step: "codes", recoveryCodes: (await confirm.mutateAsync(value)).recoveryCodes });
    } catch (err) {
      setCode("");
      if (err instanceof ApiError && err.status === 409) {
        setState(null);
        onExpired();
        return;
      }
      // Throttled or wrong code: shown by the field. Anything else failed server-side. The boxes are emptied for the next code.
      const shown =
        throttledError(t, err) ?? (err instanceof ApiError && err.status === 400 ? t("twoFactor.wrongCode") : null);
      if (shown) setError(shown);
      else showError(t("twoFactor.setupFailed"));
    }
  };

  const typeCode = (digits: string) => {
    setCode(digits);
    setError(null);
    if (digits.length === TOTP_DIGITS) void submitCode(digits);
  };

  const withSetup = (step: "scan" | "code") =>
    setState((s) => (s && s.step !== "codes" ? { step, setup: s.setup } : s));

  const backToScan = () => {
    setError(null);
    withSetup("scan");
  };

  return {
    state,
    code,
    error,
    begin,
    typeCode,
    submitCode: () => void submitCode(code),
    toCode: () => withSetup("code"),
    backToScan,
    close: () => setState(null),
    busy: start.isPending || confirm.isPending,
  };
}

export type TotpEnrolment = ReturnType<typeof useTotpEnrolment>;
