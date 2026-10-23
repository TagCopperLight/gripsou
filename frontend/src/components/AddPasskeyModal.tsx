import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { startRegistration, WebAuthnAbortService } from "@simplewebauthn/browser";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { ApiError } from "../api/client";
import { usePasskeyRegisterOptions, useReauth, useRegisterPasskey } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";

type Step = "password" | "waiting" | "done" | "failed";

/** Adding a passkey: the password, the browser's own window, then the
 *  result. Try again reuses the password check while it lasts (5 minutes). */
export function AddPasskeyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<"notAdded" | "alreadyAdded">("notAdded");
  const [name, setName] = useState("");
  const token = useRef<string | null>(null);
  // Set when the window closes, so a browser window still settling is ignored.
  const closed = useRef(false);

  const reauth = useReauth();
  const options = usePasskeyRegisterOptions();
  const register = useRegisterPasskey();

  const close = () => {
    closed.current = true;
    WebAuthnAbortService.cancelCeremony();
    onClose();
  };

  /** The password check expired or was refused: ask for it again. */
  const backToPassword = (message: string | null) => {
    token.current = null;
    setPassword("");
    setError(message);
    setStep("password");
  };

  const create = async () => {
    const reauthToken = token.current;
    if (!reauthToken) return;
    setStep("waiting");
    try {
      const { challenge, options: optionsJSON } = await options.mutateAsync(reauthToken);
      const credential = await startRegistration({ optionsJSON });
      const added = await register.mutateAsync({ reauth: reauthToken, challenge, credential });
      if (closed.current) return;
      setName(added.name);
      setStep("done");
    } catch (err) {
      if (closed.current) return;
      if (err instanceof ApiError && err.status === 401) {
        backToPassword(t("passkeys.expired"));
        return;
      }
      // The browser refuses a device that already holds one of the user's
      // passkeys (InvalidStateError); the server answers 409 for the same.
      const already =
        (err instanceof Error && err.name === "InvalidStateError") ||
        (err instanceof ApiError && err.status === 409);
      setFailure(already ? "alreadyAdded" : "notAdded");
      setStep("failed");
    }
  };

  const submitPassword = async () => {
    if (!password || reauth.isPending) return;
    setError(null);
    try {
      token.current = (await reauth.mutateAsync(password)).reauth;
    } catch (err) {
      const minutes = throttleMinutes(err);
      setError(
        minutes !== null
          ? t("auth.tooManyAttempts", { count: minutes })
          : err instanceof ApiError && err.status === 400
            ? t("twoFactor.wrongPassword")
            : t("passkeys.failed"),
      );
      return;
    }
    void create();
  };

  const centred = "flex flex-col items-center gap-4 py-4 text-center";
  let body;
  let footer;
  if (step === "password") {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">{t("settings.account.currentPassword")}</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
          />
        </label>
        {error && <p className="text-sm text-red">{error}</p>}
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
        <Button onClick={() => void submitPassword()} disabled={!password || reauth.isPending}>
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
    <Dialog title={t("passkeys.addTitle")} onClose={close} busy={reauth.isPending} footer={footer}>
      {body}
    </Dialog>
  );
}
