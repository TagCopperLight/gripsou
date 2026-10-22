import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download } from "lucide-react";

import { Button } from "./Button";

/** Freshly issued backup codes, with Copy and Download. Shown once: the
 *  server only keeps their hashes. */
export function BackupCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([`gripsou backup codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gripsou-backup-codes.txt";
    a.click();
    // Revoke later: some browsers start the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-dim">{t("twoFactor.codesIntro")}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-5 py-4 font-mono text-[15px] text-fg">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex items-center gap-2 bg-surface-2" onClick={() => void copy()}>
          {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
          {copied ? t("twoFactor.copied") : t("twoFactor.copy")}
        </Button>
        <Button variant="ghost" className="flex items-center gap-2 bg-surface-2" onClick={download}>
          <Download className="size-4" />
          {t("twoFactor.download")}
        </Button>
      </div>
    </div>
  );
}
