import { useState } from "react";
import { useTranslation } from "react-i18next";

import { showError } from "../../../lib/errorToasts";
import { ApiError } from "../../../api/client";
import { useTotpConfirm, useTotpSetup } from "../../../api/auth";
import { TOTP_DIGITS, type TotpSetup } from "../../../api/wire";
import { throttledError } from "../../../auth/throttle";

/** Where a setup is. Scanning and the first code need the server's secret;
 *  the last step shows the backup codes the confirmed code earned. */
export type TotpState =
  | { step: "scan" | "code"; setup: TotpSetup }
  | { step: "codes"; recoveryCodes: string[] };

/** Setting up an authenticator once the password is checked (or needs no
 *  check): scan, first code, backup codes. `state` is null until `begin`, and
 *  again when the setup expired (10 minutes), after `onExpired`. Each `begin`
 *  starts with an empty code. */
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

  /** Between scanning and the code, which share the setup. */
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
    /** Leaves the setup (abandoned, or done once the codes are saved). */
    close: () => setState(null),
    busy: start.isPending || confirm.isPending,
  };
}

export type TotpEnrolment = ReturnType<typeof useTotpEnrolment>;
