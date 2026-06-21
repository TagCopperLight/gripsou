import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Copy, Check } from "lucide-react";
import { Button } from "./Button";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-fg">{title}</h2>
            <p className="text-sm font-medium text-fg-faint">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-6 pt-3 pb-5">
          <p className="text-sm text-fg-dim">{body}</p>
          {error ? (
            <p className="mt-4 text-sm text-red">{t("settings.linkError")}</p>
          ) : (
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-fg font-mono">
                {link ?? t("common.loading")}
              </code>
              <button
                type="button"
                onClick={copy}
                disabled={!link}
                aria-label={t("settings.copyLink")}
                className="size-10 shrink-0 rounded-xl bg-surface-2 text-fg hover:text-fg flex items-center justify-center cursor-pointer transition-colors duration-140 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button onClick={onClose}>{t("settings.done")}</Button>
        </div>
      </div>
    </div>
  );
}
