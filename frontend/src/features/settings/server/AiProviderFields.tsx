import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";

import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Select } from "../../../ui/Select";
import { CardState } from "../../../ui/CardState";
import { TextInput } from "../../../ui/TextInput";
import {
  useBudgetAiModels,
  useBudgetAiSettings,
  useSetBudgetAiSettings,
} from "../../../api/budget";

/** Which provider categorises transactions for the whole instance, and its
 *  model. Keys are saved with the API keys; a provider without one is never
 *  offered. The model is picked from the provider's own list; when that list
 *  cannot be had, it is typed instead. */
export function AiProviderFields() {
  const { t } = useTranslation();
  const query = useBudgetAiSettings();
  const settings = query.data;
  const save = useSetBudgetAiSettings();
  const models = useBudgetAiModels(settings?.provider ?? null);
  const modelId = useId();
  // The model being typed, tied to the server value it started from: once a
  // save lands and the server value moves, the draft is spent and the field
  // shows the server again.
  const [draft, setDraft] = useState<{ base: string | null; value: string } | null>(null);

  const body = (() => {
    if (!settings) {
      return (
        <CardState
          variant={query.isError ? "error" : "loading"}
          onRetry={() => void query.refetch()}
          className="h-24"
        />
      );
    }
    const provider = settings.provider ?? "";
    const typed = draft && draft.base === settings.model ? draft.value : null;
    const shownModel =
      typed ?? settings.model ?? (settings.provider ? settings.defaults[settings.provider] : "");

    const pickProvider = (value: string) => {
      const next = value || null;
      const nextModel = next ? settings.defaults[next] : null;
      setDraft(null);
      save.mutate({ provider: next, model: nextModel });
    };

    const commitModel = () => {
      if (typed === null) return;
      // Blank means "the provider's default", which the server stores as no
      // model at all — the field then shows that default again.
      const next = typed.trim() || null;
      if (next === settings.model) {
        setDraft(null);
        return;
      }
      save.mutate({ provider: settings.provider, model: next });
    };

    return (
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
          <div className="flex items-center gap-3 text-sm text-fg">
            <label htmlFor={modelId} onClick={(e) => e.preventDefault()}>{t("settings.server.budgetAiModel")}</label>
            {models.isError || models.data?.length === 0 ? (
              <TextInput
                id={modelId}
                className="max-w-72 font-mono"
                value={shownModel}
                onChange={(e) => setDraft({ base: settings.model, value: e.target.value })}
                onBlur={commitModel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : (
              <Select
                id={modelId}
                className="w-72 font-mono"
                value={shownModel}
                disabled={!models.data}
                onChange={(m) => {
                  if (m !== shownModel) save.mutate({ provider: settings.provider, model: m });
                }}
                // The saved model stays listed even when the provider doesn't
                // offer it, so the control never shows a blank.
                options={[...new Set([shownModel, ...(models.data ?? [])])]
                  .filter(Boolean)
                  .sort()
                  .map((m) => ({ value: m, label: m }))}
              />
            )}
          </div>
        )}
        {settings.provider && models.isError && (
          <p className="w-full text-xs text-fg-faint">{t("settings.server.budgetAiModelsError")}</p>
        )}
      </div>
    );
  })();

  useErrorToast(save.isError && t("settings.server.budgetAiSaveError"));

  return body;
}
