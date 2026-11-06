import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Toggle } from "../../../ui/Toggle";
import { CardState } from "../../../ui/CardState";
import { ApiKeysSurface } from "./ApiKeysSurface";
import { AiServerSurface } from "./AiServerSurface";
import { AiCostSurface } from "./AiCostSurface";
import { useProviders, useSetProviderEnabled } from "../../../api/admin";
import { useHealth } from "../../../api/health";

export function SettingsServer() {
  const { t } = useTranslation();
  const version = useHealth().data?.version;
  const providers = useProviders();
  const { data: providersData, isError: providersIsError, refetch: providersRefetch } = providers;
  const providersReady = providersData !== undefined;
  const setEnabled = useSetProviderEnabled();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <SettingsSurface className="md:mt-13" title={t("settings.server.about")}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-fg">{t("settings.server.version")}</span>
          {/* select-all so it is one click to paste into a bug report */}
          <span className="select-all text-sm text-fg-faint">{version ?? "—"}</span>
        </div>
      </SettingsSurface>
      <ApiKeysSurface />
      <SettingsSurface title={t("settings.server.providers")} hint={t("settings.server.providersHint")}>
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
      </SettingsSurface>
      <AiServerSurface />
      <AiCostSurface />
    </div>
  );
}
