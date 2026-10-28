import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { Toggle } from "../../components/Toggle";
import { CardState } from "../../components/CardState";
import { ApiKeysSurface } from "../../components/ApiKeysSurface";
import { AiServerSurface } from "../../components/budget/AiServerSurface";
import { AiCostSurface } from "../../components/budget/AiCostSurface";
import { useProviders, useSetProviderEnabled, useHealth } from "../../api/hooks";

export function SettingsServer() {
  const { t } = useTranslation();
  const version = useHealth().data?.version;
  const providers = useProviders();
  const { data: providersData, isError: providersIsError, refetch: providersRefetch } = providers;
  const providersReady = providersData !== undefined;
  const setEnabled = useSetProviderEnabled();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Surface className="p-6 md:mt-13">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.server.about")}</h2>
        <div className="flex items-center gap-3 pt-4">
          <span className="text-sm font-medium text-fg">{t("settings.server.version")}</span>
          {/* select-all so it is one click to paste into a bug report */}
          <span className="select-all text-sm text-fg-faint">{version ?? "—"}</span>
        </div>
      </Surface>
      <ApiKeysSurface />
      <Surface className="p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">
          {t("settings.server.providers")}
        </h2>
        <p className="mb-5 text-xs text-fg-faint">{t("settings.server.providersHint")}</p>
        {!providersReady ? (
          <CardState
            variant={providersIsError ? "error" : "loading"}
            onRetry={() => providersRefetch()}
            className="mt-4 h-64"
          />
        ) : (
          <div className="flex flex-col divide-y divide-surface-2">
            {providersData.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-fg">{p.displayName}</span>
                  {p.description && (
                    <span className="text-xs text-fg-faint">{p.description}</span>
                  )}
                </div>
                <Toggle
                  aria-label={p.displayName}
                  checked={p.enabled}
                  disabled={setEnabled.isPending && setEnabled.variables?.key === p.key}
                  onChange={(enabled) => setEnabled.mutate({ key: p.key, enabled })}
                />
              </div>
            ))}
          </div>
        )}
      </Surface>
      <AiServerSurface />
      <AiCostSurface />
    </div>
  );
}
