import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";

import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { showError } from "../../lib/errorToasts";
import { useMfaStatus } from "../../api/auth";
import { PasskeyRow, TotpRow } from "../settings/security/SecurityRow";
import { BackupCodes } from "../settings/security/BackupCodes";
import { TotpCode, TotpScan } from "../settings/security/TotpSteps";
import { useTotpEnrolment } from "../settings/security/useTotpEnrolment";
import { usePasskeyCreation } from "../settings/security/usePasskeyCreation";
import { WelcomeFooter, WelcomeSkip } from "./WelcomeFooter";

type PasskeyState = "idle" | "waiting" | "notAdded" | "alreadyAdded";

/** An authenticator app and passkeys, both optional. The welcome flow asks
 *  for no password: the server allows it until the flow is finished. An
 *  admin's account guards the whole server: skipping asks first. */
export function SecurityScreen({
  confirmSkip, onBack, onNext,
}: { confirmSkip: boolean; onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  const mfa = useMfaStatus();
  const enrolment = useTotpEnrolment(() => showError(t("welcome.twoFactor.expired")));
  const creation = usePasskeyCreation();
  const [passkey, setPasskey] = useState<PasskeyState>("idle");
  const [confirming, setConfirming] = useState(false);
  // Leaving the screen closes a browser window still open.
  useEffect(() => creation.cancel, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { state } = enrolment;
  if (state?.step === "scan") {
    return (
      <>
        <TotpScan setup={state.setup} />
        <WelcomeFooter onBack={enrolment.close}>
          <Button onClick={enrolment.toCode}>{t("common.next")}</Button>
        </WelcomeFooter>
      </>
    );
  }
  if (state?.step === "code") {
    return (
      <>
        <TotpCode enrolment={enrolment} />
        <WelcomeFooter onBack={enrolment.backToScan}>{null}</WelcomeFooter>
      </>
    );
  }
  if (state?.step === "codes") {
    return (
      <>
        <BackupCodes codes={state.recoveryCodes} />
        <WelcomeFooter>
          <Button onClick={enrolment.close}>{t("twoFactor.done")}</Button>
        </WelcomeFooter>
      </>
    );
  }

  const addPasskey = async () => {
    setPasskey("waiting");
    const outcome = await creation.create(undefined);
    if (outcome.kind === "cancelled") return;
    // The welcome flow needs no password check, so none can expire: a
    // refusal there is a passkey that wasn't added.
    setPasskey(outcome.kind === "added" ? "idle" : outcome.kind === "alreadyAdded" ? "alreadyAdded" : "notAdded");
  };

  const totp = mfa.data?.totp ?? false;
  const passkeys = mfa.data?.passkeys.length ?? 0;
  const passkeyHint =
    passkey === "waiting" ? t("passkeys.waiting")
    : passkey === "idle" ? passkeys > 0 && t("welcome.twoFactor.passkeyCount", { count: passkeys })
    : <span className="text-red">{t(`passkeys.${passkey}`)}</span>;

  return (
    <>
      <div className="flex flex-col gap-2">
        <TotpRow
          action={
            totp ? (
              <span className="flex items-center gap-1.5 px-3.5 text-sm text-green">
                <Check className="size-4" />
                {t("welcome.twoFactor.on")}
              </span>
            ) : (
              <Button variant="ghostStrong" onClick={() => void enrolment.begin()} disabled={enrolment.busy}>
                {t("welcome.twoFactor.setUp")}
              </Button>
            )
          }
        />
        <PasskeyRow
          hint={passkeyHint}
          action={
            passkey === "waiting" ? (
              <span className="flex px-3.5">
                <LoaderCircle aria-label={t("passkeys.waiting")} className="size-4.5 animate-spin text-fg-faint" />
              </span>
            ) : (
              <Button variant="ghostStrong" onClick={() => void addPasskey()}>
                {t(passkeys > 0 ? "welcome.twoFactor.addAnother" : "welcome.twoFactor.add")}
              </Button>
            )
          }
        />
      </div>
      <WelcomeFooter onBack={onBack}>
        {!(totp || passkeys > 0) && (
          <WelcomeSkip onClick={confirmSkip ? () => setConfirming(true) : onNext} />
        )}
        <Button onClick={onNext} disabled={!(totp || passkeys > 0)}>{t("common.next")}</Button>
      </WelcomeFooter>
      {confirming && (
        // Setting it up is the button that stands out: skipping is the choice to think twice about.
        <Dialog
          title={t("welcome.twoFactor.skipTitle")}
          icon={<TriangleAlert className="size-5 text-amber" />}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={onNext}>{t("welcome.twoFactor.skipConfirm")}</Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  void enrolment.begin();
                }}
              >
                {t("welcome.twoFactor.setUpNow")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-dim">{t("welcome.twoFactor.skipBody")}</p>
        </Dialog>
      )}
    </>
  );
}
