import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { CardState } from "./CardState";
import { Dialog } from "./Dialog";
import { useEnabledProviders, useInitConnection } from "../api/hooks";
import type { EnabledProvider } from "../api/types";
import { goTo } from "../lib/navigate";

type AddConnectionModalProps = {
  onClose: () => void;
  /** Where to go when the provider needs no redirect. */
  returnTo?: string;
};

export function AddConnectionModal({ onClose, returnTo = "/settings/connections" }: AddConnectionModalProps) {
  const { t } = useTranslation();
  const { data: providers, isLoading, isError } = useEnabledProviders();
  const initConnection = useInitConnection();
  const [selected, setSelected] = useState<string | null>(null);

  const connect = () => {
    if (!selected) return;
    initConnection.mutate(selected, {
      onSuccess: ({ redirectUrl }) => {
        goTo(redirectUrl ?? returnTo);
      },
    });
  };

  return (
    <Dialog
      title={t("settings.connections.pickProvider")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={connect}
            disabled={!selected || initConnection.isPending}
            aria-label={t("settings.connections.connect")}
          >
            {t("settings.connections.connect")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {isLoading && <CardState variant="loading" className="h-32" />}
        {isError && <CardState variant="error" className="h-32" />}
        {!isLoading && !isError && providers?.length === 0 && (
          <p className="text-sm text-fg-faint py-6 text-center">
            {t("settings.connections.noProviders")}
          </p>
        )}
        {providers?.map((p) => (
          <ProviderCard
            key={p.key}
            provider={p}
            selected={selected === p.key}
            onSelect={() => setSelected(p.key)}
          />
        ))}
        {initConnection.isError && (
          <p className="text-sm text-red">{t("settings.connections.connectError")}</p>
        )}
      </div>
    </Dialog>
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
