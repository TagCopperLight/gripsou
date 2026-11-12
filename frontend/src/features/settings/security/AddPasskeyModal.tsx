import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";

import { Dialog } from "../../../ui/Dialog";
import { Button } from "../../../ui/Button";
import { PasswordField } from "../../../ui/PasswordField";
import { useReauthStep } from "../../../auth/useReauthStep";
import { usePasskeyCreation } from "./usePasskeyCreation";

type Step = "password" | "waiting" | "done" | "failed";

/** Adding a passkey: the password, the browser's own window, then the
 *  result. Try again reuses the password check while it lasts (5 minutes). */
export function AddPasskeyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("password");
  const { password, setPassword, error, setError, checking, check } = useReauthStep();
  const [failure, setFailure] = useState<"notAdded" | "alreadyAdded">("notAdded");
  const [name, setName] = useState("");
  const token = useRef<string | null>(null);
  const creation = usePasskeyCreation();

  const close = () => {
    creation.cancel();
    onClose();
  };

  const create = async () => {
    const reauth = token.current;
    if (!reauth) return;
    setStep("waiting");
    const outcome = await creation.create(reauth);
    switch (outcome.kind) {
      case "cancelled":
        return;
      case "added":
        setName(outcome.name);
        setStep("done");
        return;
      case "expired":
        // The password check expired or was refused: ask for it again.
        token.current = null;
        setPassword("");
        setError(t("passkeys.expired"));
        setStep("password");
        return;
      default:
        setFailure(outcome.kind);
        setStep("failed");
    }
  };

  const submitPassword = async () => {
    if (!password || checking) return;
    token.current = await check();
    void create();
  };

  const centred = "flex flex-col items-center gap-4 py-4 text-center";
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
        <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
        <Button onClick={() => void submitPassword()} disabled={!password || checking}>
          {t("twoFactor.continue")}
        </Button>
      </>
    );
  } else if (step === "waiting") {
    body = (
      <div className={centred}>
        <LoaderCircle className="size-8 animate-spin text-green" />
        <p className="text-lg font-semibold text-fg">{t("passkeys.waiting")}</p>
      </div>
    );
    footer = <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>;
  } else if (step === "done") {
    body = (
      <div className={centred}>
        <span className="flex size-11 items-center justify-center rounded-full bg-green-soft text-green">
          <Check className="size-5" />
        </span>
        <p className="text-lg font-semibold text-fg">{t("passkeys.addedTitle")}</p>
        <p className="text-sm text-fg-faint">{name}</p>
      </div>
    );
    footer = <Button onClick={close}>{t("twoFactor.done")}</Button>;
  } else {
    body = (
      <div className={centred}>
        <span className="flex size-11 items-center justify-center rounded-full bg-red-soft text-red">
          <CircleAlert className="size-5" />
        </span>
        <p className="text-lg font-semibold text-fg">{t(`passkeys.${failure}`)}</p>
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
        {failure === "notAdded" && (
          <Button onClick={() => void create()}>{t("passkeys.tryAgain")}</Button>
        )}
      </>
    );
  }

  return (
    <Dialog title={t("passkeys.addTitle")} onClose={close} busy={checking} footer={footer}>
      {body}
    </Dialog>
  );
}
