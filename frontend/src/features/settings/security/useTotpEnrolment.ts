import { useState } from "react";
import { useTranslation } from "react-i18next";

import { showError } from "../../../lib/errorToasts";
import { ApiError } from "../../../api/client";
import { useTotpConfirm, useTotpSetup } from "../../../api/auth";
import { TOTP_DIGITS, type TotpSetup } from "../../../api/wire";
import { throttledError } from "../../../auth/throttle";

export type TotpStep = "scan" | "code" | "codes";

/** Setting up an authenticator once the password is checked (or needs no
 *  check): scan, first code, backup codes. `step` is null until `begin`, and
 *  again when the setup expired (10 minutes), after `onExpired`. */
export function useTotpEnrolment(onExpired: () => void) {
  const { t } = useTranslation();
  const start = useTotpSetup();
  const confirm = useTotpConfirm();
  const [step, setStep] = useState<TotpStep | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const begin = async (reauth?: string) => {
    try {
      setSetup(await start.mutateAsync(reauth));
      setStep("scan");
    } catch {
      showError(t("twoFactor.setupFailed"));
    }
  };

  const submitCode = async (value: string) => {
    if (value.length !== TOTP_DIGITS || confirm.isPending) return;
    setError(null);
    try {
      setRecoveryCodes((await confirm.mutateAsync(value)).recoveryCodes);
      setStep("codes");
    } catch (err) {
      setCode("");
      if (err instanceof ApiError && err.status === 409) {
        setStep(null);
        onExpired();
        return;
      }
      // Throttled or a wrong code, next to the field; anything else failed on
      // the server's side. The boxes are emptied for the next code.
      const shown =
        throttledError(t, err) ?? (err instanceof ApiError && err.status === 400 ? t("twoFactor.wrongCode") : null);
      if (shown) setError(shown);
      else showError(t("twoFactor.setupFailed"));
    }
  };

  /** The sixth digit sends the code; there is no button for it. */
  const typeCode = (digits: string) => {
    setCode(digits);
    setError(null);
    if (digits.length === TOTP_DIGITS) void submitCode(digits);
  };

  const backToScan = () => {
    setError(null);
    setStep("scan");
  };

  return {
    step,
    setup,
    code,
    error,
    recoveryCodes,
    begin,
    typeCode,
    submitCode: () => void submitCode(code),
    toCode: () => setStep("code"),
    backToScan,
    /** Leaves the setup (abandoned, or done once the codes are saved). */
    close: () => setStep(null),
    busy: start.isPending || confirm.isPending,
  };
}

export type TotpEnrolment = ReturnType<typeof useTotpEnrolment>;
