import { useTranslation } from "react-i18next";

import { Dialog } from "../../../ui/Dialog";
import { Button } from "../../../ui/Button";
import { BackupCodes } from "./BackupCodes";
import { StepDots } from "../../../ui/StepDots";
import { PasswordField } from "../../../ui/PasswordField";
import { useReauthStep } from "../../../auth/useReauthStep";
import { useTotpEnrolment } from "./useTotpEnrolment";
import { TotpCode, TotpScan } from "./TotpSteps";

const STEPS = ["password", "scan", "code", "codes"] as const;

/** Turning two-factor on: password, scan, first code, backup codes. */
export function TotpSetupModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { password, setPassword, error, setError, checking, check } = useReauthStep();
  // An expired setup starts over from the password.
  const enrolment = useTotpEnrolment(() => {
    setPassword("");
    setError(t("twoFactor.expired"));
  });
  const step = enrolment.step ?? "password";
  const busy = checking || enrolment.busy;

  const submitPassword = async () => {
    if (!password || busy) return;
    const token = await check();
    if (token) await enrolment.begin(token);
  };

  let body;
  let footer;
  if (step === "password") {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
        <PasswordField value={password} onChange={setPassword} autoFocus error={error} />
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={() => void submitPassword()} disabled={!password || busy}>{t("twoFactor.continue")}</Button>
      </>
    );
  } else if (step === "scan" && enrolment.setup) {
    body = <TotpScan setup={enrolment.setup} />;
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={enrolment.toCode}>{t("common.next")}</Button>
      </>
    );
  } else if (step === "code") {
    body = <TotpCode enrolment={enrolment} />;
    footer = <Button variant="ghost" onClick={enrolment.backToScan}>{t("common.back")}</Button>;
  } else {
    body = <BackupCodes codes={enrolment.recoveryCodes} />;
    footer = <Button onClick={onClose}>{t("twoFactor.done")}</Button>;
  }

  return (
    <Dialog
      // One dialog per step, so focus lands on each step's first control.
      key={step}
      title={step === "codes" ? t("twoFactor.codesTitle") : t("twoFactor.setupTitle")}
      onClose={onClose}
      busy={busy}
      aside={<StepDots current={STEPS.indexOf(step)} total={STEPS.length} />}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
