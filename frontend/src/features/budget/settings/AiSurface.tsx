import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CardState } from "../../../ui/CardState";
import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Toggle } from "../../../ui/Toggle";
import { useAuth } from "../../../auth/context";
import { useAiStatus } from "../../../api/budget";
import { BUDGET_AI_THRESHOLD_MAX, BUDGET_AI_THRESHOLD_MIN } from "../../../api/wire";

/** Settings → Budget: the per-user half of AI categorisation: opt-in and threshold. The
 *  provider, model and key are the operator's (Settings → Server). */
export function AiSurface() {
  const { t } = useTranslation();
  const status = useAiStatus();
  // Until the server answers, whether a provider is set up is unknown: no warning yet.
  return (
    <SettingsSurface title={t("settings.budget.ai.title")}>
      {status.data !== undefined ? (
        <AiControls configured={status.data.configured} />
      ) : (
        <CardState variant={status.isError ? "error" : "loading"} onRetry={() => void status.refetch()} className="h-28" />
      )}
    </SettingsSurface>
  );
}

function AiControls({ configured }: { configured: boolean }) {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useAuth();
  // Local while dragging; saved once on release, not on every tick.
  const [draft, setDraft] = useState<number | null>(null);
  const threshold = draft ?? prefs.budgetAiThreshold;

  const commit = () => {
    if (draft !== null && draft !== prefs.budgetAiThreshold) {
      void updatePrefs({ budgetAiThreshold: draft });
    }
    setDraft(null);
  };

  return (
    <>
      {!configured && <p className="mb-4 text-sm text-fg-faint">{t("settings.budget.ai.notConfigured")}</p>}
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-fg">{t("settings.budget.ai.enable")}</p>
          <p className="text-xs text-fg-faint">{t("settings.budget.ai.enableHint")}</p>
        </div>
        <Toggle
          checked={prefs.budgetAiEnabled}
          disabled={!configured}
          onChange={(v) => void updatePrefs({ budgetAiEnabled: v })}
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
            min={BUDGET_AI_THRESHOLD_MIN}
            max={BUDGET_AI_THRESHOLD_MAX}
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
    </>
  );
}
