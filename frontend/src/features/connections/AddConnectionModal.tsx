import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/Button";
import { CardError } from "../../ui/CardError";
import { Dialog } from "../../ui/Dialog";
import { Skeleton, TextBone } from "../../ui/Skeleton";
import { useStartConnection } from "./useStartConnection";
import type { EnabledProvider } from "../../api/wire";

type AddConnectionModalProps = {
  onClose: () => void;
  returnTo?: string;
};

export function AddConnectionModal({ onClose, returnTo = "/settings/connections" }: AddConnectionModalProps) {
  const { t } = useTranslation();
  const flow = useStartConnection({ returnTo, errorMessage: t("settings.connections.connectError") });
  const { data: providers, isPending, isError } = flow.providers;
  const [selected, setSelected] = useState<string | null>(null);

  const connect = () => {
    if (selected) flow.connect(selected);
  };

  return (
    <Dialog
      title={t("settings.connections.pickProvider")}
      onClose={onClose}
      busy={flow.pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={connect}
            disabled={!selected}
            busy={flow.pending}
            busyLabel={t("common.busy.connecting")}
          >
            {t("settings.connections.connect")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {isPending && <ProviderCardsSkeleton />}
        {isError && <CardError className="h-32" />}
        {providers?.length === 0 && (
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
      </div>
    </Dialog>
  );
}

function ProviderCardsSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-3">
      {Array.from({ length: 2 }, (_, card) => (
        <div key={card} className="rounded-2xl border border-surface-2 bg-surface-2 px-4 py-3">
          <TextBone text="text-sm" className="w-28" />
          <TextBone text="mt-0.5 text-xs" className="w-56" />
        </div>
      ))}
    </Skeleton>
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
