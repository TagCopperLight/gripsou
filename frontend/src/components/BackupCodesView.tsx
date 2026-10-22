import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "./Button";

/** The one-time backup codes, with the warning that they are shown only now
 *  and ways to keep them: copy to the clipboard or download as a text file. */
export function BackupCodesView({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
    } catch {
      return; // clipboard refused (insecure context): Download still works
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([codes.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "gripsou-backup-codes.txt";
    // In the document during the click, and the URL kept until the click has
    // been handled: some browsers cancel the download otherwise.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-amber">{t("settings.security.backupCodesWarning")}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-[15px] text-fg">
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="ghost" type="button" onClick={copy}>
          {copied ? t("settings.security.copied") : t("settings.security.copy")}
        </Button>
        <Button variant="ghost" type="button" onClick={download}>
          {t("settings.security.download")}
        </Button>
      </div>
    </div>
  );
}
