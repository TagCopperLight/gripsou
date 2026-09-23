import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { Toggle } from "../Toggle";
import { useAuth } from "../../auth/context";
import { useAiStatus } from "../../api/budget";

/** §4.3 — the per-user half of AI categorisation: opt-in and threshold. The
 *  provider, model and key are the operator's (Settings → Server / .env). */
export function AiSurface() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useAuth();
  const configured = useAiStatus().data?.configured ?? false;
  // Local while dragging; saved once on release, not on every tick.
  const [draft, setDraft] = useState<number | null>(null);
  const threshold = draft ?? prefs.budgetAiThreshold;

  const commit = () => {
    if (draft !== null && draft !== prefs.budgetAiThreshold) {
      void updatePrefs({ ...prefs, budgetAiThreshold: draft });
    }
    setDraft(null);
  };

  return (
    <Surface className="p-6">
      <h2 className="mb-5 text-lg font-semibold text-fg">{t("settings.budget.ai.title")}</h2>
      {!configured && <p className="mb-4 text-sm text-amber">{t("settings.budget.ai.notConfigured")}</p>}
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-fg">{t("settings.budget.ai.enable")}</p>
          <p className="text-xs text-fg-faint">{t("settings.budget.ai.enableHint")}</p>
        </div>
        <Toggle
          checked={prefs.budgetAiEnabled}
          disabled={!configured}
          onChange={(v) => void updatePrefs({ ...prefs, budgetAiEnabled: v })}
          aria-label={t("settings.budget.ai.enable")}
        />
      </div>
      <div className={`mt-6 flex items-center justify-between gap-6 ${configured ? "" : "opacity-40"}`}>
        <div>
          <p className="text-sm font-medium text-fg">{t("settings.budget.ai.threshold")}</p>
          <p className="text-xs text-fg-faint">{t("settings.budget.ai.thresholdHint")}</p>
        </div>
        <div className="flex w-64 items-center gap-3">
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={threshold}
            disabled={!configured}
            aria-label={t("settings.budget.ai.threshold")}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            className="flex-1 accent-[var(--color-green)]"
          />
          <span className="w-10 text-right font-mono text-sm text-fg">{threshold}%</span>
        </div>
      </div>
    </Surface>
  );
}
