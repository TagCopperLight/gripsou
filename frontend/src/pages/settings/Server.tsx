import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Toggle } from "../../components/Toggle";
import { CardState } from "../../components/CardState";
import { useProviders, useSetProviderEnabled, useCorsOrigins, useSetCorsOrigins } from "../../api/hooks";

export function SettingsServer() {
  const { t } = useTranslation();
  const providers = useProviders();
  const { data: providersData, isError: providersIsError, refetch: providersRefetch } = providers;
  const providersReady = providersData !== undefined;
  const setEnabled = useSetProviderEnabled();

  const originsQuery = useCorsOrigins();
  const setCorsOrigins = useSetCorsOrigins();
  const origins = originsQuery.data || [];

  const [draft, setDraft] = useState("");

  const addOrigin = () => {
    const value = draft.trim();
    if (!value || origins.includes(value)) return;
    setCorsOrigins.mutate([...origins, value]);
    setDraft("");
  };

  const removeOrigin = (origin: string) => {
    setCorsOrigins.mutate(origins.filter((o) => o !== origin));
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Surface className="p-6 md:mt-13">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.server.cors")}</h2>
        <p className="mb-5 text-xs text-fg-faint">{t("settings.server.corsHint")}</p>
        <div className="flex flex-col gap-2">
          {origins.map((origin) => (
            <div
              key={origin}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.25"
            >
              <span className="text-sm text-fg truncate">{origin}</span>
              <button
                type="button"
                aria-label={`Remove ${origin}`}
                onClick={() => removeOrigin(origin)}
                disabled={setCorsOrigins.isPending}
                className="-my-1 p-1.5 rounded-lg text-fg-faint hover:bg-surface hover:text-red transition-colors duration-140 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addOrigin();
              }}
              placeholder={t("settings.server.corsPlaceholder")}
              className="w-full bg-surface-2 rounded-xl px-3.5 py-2.25 text-fg text-sm outline-none focus:ring-1 focus:ring-green"
            />
            <Button onClick={addOrigin} disabled={!draft.trim() || setCorsOrigins.isPending}>
              {t("settings.server.add")}
            </Button>
          </div>
        </div>
      </Surface>
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
    </div>
  );
}
