import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { SegmentedControl } from "../SegmentedControl";
import { CardState } from "../CardState";
import {
  useBudgetAiSettings,
  useSetBudgetAiSettings,
  type BudgetAiProvider,
} from "../../api/budget";

/** Settings → Server: which provider categorises transactions for the whole
 *  instance. Keys live in the server's environment; a provider without one is
 *  never offered. */
export function AiServerSurface() {
  const { t } = useTranslation();
  const query = useBudgetAiSettings();
  const settings = query.data;
  const save = useSetBudgetAiSettings();
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
      const next = (value || null) as BudgetAiProvider | null;
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
          <label className="flex items-center gap-3 text-sm text-fg">
            {t("settings.server.budgetAiModel")}
            <input
              className="rounded-xl bg-surface-2 px-3.5 py-2 font-mono text-sm text-fg"
              value={shownModel}
              onChange={(e) => setDraft({ base: settings.model, value: e.target.value })}
              onBlur={commitModel}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
        )}
      </div>
    );
  })();

  return (
    <Surface className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.server.budgetAi")}</h2>
      <p className="mb-5 text-xs text-fg-faint">{t("settings.server.budgetAiHint")}</p>
      {body}
      {save.isError && (
        <p role="alert" className="mt-3 text-xs text-red">
          {t("settings.server.budgetAiSaveError")}
        </p>
      )}
    </Surface>
  );
}
