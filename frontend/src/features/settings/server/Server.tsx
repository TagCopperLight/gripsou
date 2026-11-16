import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Toggle } from "../../../ui/Toggle";
import { CardError } from "../../../ui/CardError";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { ApiKeysSurface } from "./ApiKeysSurface";
import { AiServerSurface } from "./AiServerSurface";
import { AiCostSurface } from "./AiCostSurface";
import { useProviders, useSetProviderEnabled } from "../../../api/admin";
import { useHealth } from "../../../api/health";
import { boneWidths } from "../../../ui/boneWidths";

const PROVIDER_ROW = "flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0";

export function SettingsServer() {
  const { t } = useTranslation();
  const health = useHealth();
  const providers = useProviders();
  const setEnabled = useSetProviderEnabled();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <SettingsSurface className="md:mt-13" title={t("settings.server.about")}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-fg">{t("settings.server.version")}</span>
          {/* select-all so it is one click to paste into a bug report */}
          {health.isPending ? (
            <Skeleton>
              <TextBone text="text-sm" className="w-12" />
            </Skeleton>
          ) : (
            <span className="select-all text-sm text-fg-faint">{health.data?.version ?? "—"}</span>
          )}
        </div>
      </SettingsSurface>
      <ApiKeysSurface />
      <SettingsSurface title={t("settings.server.providers")} hint={t("settings.server.providersHint")}>
        {providers.isError ? (
          <CardError onRetry={() => providers.refetch()} className="mt-4 h-64" />
        ) : providers.isPending ? (
          <Skeleton className="flex flex-col divide-y divide-surface-2">
            {boneWidths(1).map((w) => (
              <div key={w} className={PROVIDER_ROW}>
                <div className="flex flex-1 flex-col gap-1">
                  <TextBone text="text-sm" className="w-24" />
                  <TextBone text="text-xs" style={{ width: `${w}%` }} />
                </div>
                <Bone className="h-6 w-11 rounded-full" />
              </div>
            ))}
          </Skeleton>
        ) : (
          <div className="flex flex-col divide-y divide-surface-2">
            {providers.data.map((p) => (
              <div key={p.key} className={PROVIDER_ROW}>
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
