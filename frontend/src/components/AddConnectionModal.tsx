import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "./Button";
import { CardState } from "./CardState";
import { useEnabledProviders, useInitConnection } from "../api/hooks";
import type { EnabledProvider } from "../api/types";

type AddConnectionModalProps = {
  onClose: () => void;
};

export function AddConnectionModal({ onClose }: AddConnectionModalProps) {
  const { t } = useTranslation();
  const { data: providers, isLoading, isError } = useEnabledProviders();
  const initConnection = useInitConnection();
  const [selected, setSelected] = useState<string | null>(null);

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

  const connect = () => {
    if (!selected) return;
    initConnection.mutate(selected, {
      onSuccess: ({ redirectUrl }) => {
        if (redirectUrl) {
          window.location.href = redirectUrl;
        } else {
          window.location.href = "/settings/connections";
        }
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.pickProvider")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0">
          <h2 className="text-xl font-semibold text-fg">
            {t("settings.pickProvider")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 px-6 py-4 flex flex-col gap-3 overflow-y-auto">
          {isLoading && <CardState variant="loading" className="h-32" />}
          {isError && <CardState variant="error" className="h-32" />}
          {providers?.map((p) => (
            <ProviderCard
              key={p.key}
              provider={p}
              selected={selected === p.key}
              onSelect={() => setSelected(p.key)}
            />
          ))}
          {initConnection.isError && (
            <p className="text-sm text-red">{t("settings.connectError")}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-3 shrink-0 border-t border-surface-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={connect}
            disabled={!selected || initConnection.isPending}
            aria-label={t("settings.connect")}
          >
            {t("settings.connect")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  selected,
  onSelect,
}: {
  provider: EnabledProvider;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-2xl px-4 py-3 transition-colors duration-140 border cursor-pointer ${
        selected
          ? "border-green bg-green-soft"
          : "border-surface-2 bg-surface-2 hover:border-surface-3"
      }`}
    >
      <p className="text-sm font-medium text-fg">{provider.displayName}</p>
      {provider.description && (
        <p className="text-xs text-fg-faint mt-0.5">{provider.description}</p>
      )}
    </button>
  );
}
