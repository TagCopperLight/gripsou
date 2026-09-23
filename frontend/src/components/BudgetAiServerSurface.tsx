import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { SegmentedControl } from "./SegmentedControl";
import { useBudgetAiSettings, useSetBudgetAiSettings } from "../api/hooks";
import type { BudgetAiProvider } from "../api/budget";

/** Settings → Server: which provider categorises transactions for the whole
 *  instance. Keys live in the server's environment; a provider without one is
 *  never offered. */
export function BudgetAiServerSurface() {
  const { t } = useTranslation();
  const settings = useBudgetAiSettings().data;
  const save = useSetBudgetAiSettings();
  const [model, setModel] = useState<string | null>(null);
  if (!settings) return null;

  const provider = settings.provider ?? "";
  const shownModel =
    model ?? settings.model ?? (settings.provider ? settings.defaults[settings.provider] : "");

  const pickProvider = (value: string) => {
    const next = (value || null) as BudgetAiProvider | null;
    const nextModel = next ? settings.defaults[next] : null;
    setModel(null);
    save.mutate({ provider: next, model: nextModel });
  };

  return (
    <Surface className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.server.budgetAi")}</h2>
      <p className="mb-5 text-xs text-fg-faint">{t("settings.server.budgetAiHint")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 text-sm text-fg">
          <span>{t("settings.server.budgetAiProvider")}</span>
          <SegmentedControl
            value={provider}
            onChange={pickProvider}
            options={[
              { value: "", label: t("settings.server.budgetAiOff") },
              ...settings.available.map((p) => ({ value: p, label: p })),
            ]}
          />
        </div>
        {settings.provider && (
          <label className="flex items-center gap-3 text-sm text-fg">
            {t("settings.server.budgetAiModel")}
            <input
              className="rounded-xl bg-surface-2 px-3.5 py-2 font-mono text-sm text-fg"
              value={shownModel}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => {
                if (model !== null && model !== settings.model) {
                  save.mutate({ provider: settings.provider, model: model.trim() || null });
                }
              }}
            />
          </label>
        )}
      </div>
    </Surface>
  );
}
