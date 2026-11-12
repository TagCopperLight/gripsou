import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";

import type { TotpSetup } from "../../../api/wire";
import { useCopy } from "../../../lib/useCopy";
import { CodeInput } from "../../../ui/CodeInput";
import { FieldError } from "../../../ui/FieldError";
import type { TotpEnrolment } from "./useTotpEnrolment";

/** The setup key in groups of four, easier to type into an app by hand. */
function groups(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** The QR code to scan, and the key to type in when it can't be. */
export function TotpScan({ setup }: { setup: TotpSetup }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-fg-dim">{t("twoFactor.scanIntro")}</p>
      <div className="flex justify-center">
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt={t("twoFactor.qrAlt")} className="size-44 rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-faint">{t("twoFactor.cantScan")}</span>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-4">
          <span className="font-mono text-[13px] text-fg-dim">{groups(setup.secret)}</span>
          <button
            type="button"
            onClick={() => void copy(setup.secret)}
            aria-label={t("twoFactor.copyKey")}
            className="cursor-pointer rounded-lg p-1.5 text-fg-faint transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
          >
            {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The app's first code, sent at the sixth digit. */
export function TotpCode({ enrolment }: { enrolment: TotpEnrolment }) {
  const { t } = useTranslation();
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); enrolment.submitCode(); }}>
      <p className="text-sm text-fg-dim">{t("twoFactor.codeIntro")}</p>
      <div className="flex flex-col gap-2">
        <CodeInput
          ariaLabel={t("twoFactor.codeLabel")}
          value={enrolment.code}
          autoFocus
          invalid={Boolean(enrolment.error)}
          onChange={enrolment.typeCode}
        />
        {enrolment.error && <FieldError>{enrolment.error}</FieldError>}
      </div>
      <button type="submit" hidden />
    </form>
  );
}
