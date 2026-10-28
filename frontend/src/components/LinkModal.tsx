import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorState } from "./ErrorState";
import { Copy, Check } from "lucide-react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

type LinkModalProps = {
  title: string;
  subtitle: string;
  body: string;
  link: string | null; // null while the token is still being generated
  error: boolean;
  onClose: () => void;
};

export function LinkModal({ title, subtitle, body, link, error, onClose }: LinkModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("settings.users.done")}</Button>}
    >
      <p className="text-sm text-fg-dim">{body}</p>
      {error ? (
        <ErrorState title={t("settings.users.linkError")} detail={t("common.tryAgain")} className="mt-4 py-4" />
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-fg font-mono">
            {link ?? t("common.loading")}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            aria-label={t("settings.users.copyLink")}
            className="size-10 shrink-0 rounded-xl bg-surface-2 text-fg hover:text-fg flex items-center justify-center cursor-pointer transition-colors duration-140 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
          </button>
        </div>
      )}
    </Dialog>
  );
}
