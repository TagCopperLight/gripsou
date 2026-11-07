import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { Button } from "../../../ui/Button";
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
      {status.data === undefined ? (
        <CardState variant={status.isError ? "error" : "loading"} onRetry={() => void status.refetch()} className="h-28" />
      ) : status.data.configured ? (
        <AiControls />
      ) : (
        <NoProvider />
      )}
    </SettingsSurface>
  );
}

/** Nothing in the card works without a provider, so it says only that. An admin
 *  can set one up; anyone else has no way to, so gets no button. */
function NoProvider() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useAuth().user?.role === "admin";
  return (
    <div className="flex h-28 flex-col items-center justify-center gap-2.5 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-faint">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">{t("settings.budget.ai.notConfigured")}</p>
      {isAdmin && (
        <Button
          variant="outline"
          padded={false}
          className="mt-1 rounded-lg! px-2.75 py-1.5 text-xs"
          onClick={() => void navigate({ to: "/settings/server" })}
        >
          {t("settings.budget.ai.setUp")}
        </Button>
      )}
    </div>
  );
}

function AiControls() {
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
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-fg">{t("settings.budget.ai.enable")}</p>
          <p className="text-xs text-fg-faint">{t("settings.budget.ai.enableHint")}</p>
        </div>
        <Toggle
          checked={prefs.budgetAiEnabled}
          onChange={(v) => void updatePrefs({ budgetAiEnabled: v })}
          aria-label={t("settings.budget.ai.enable")}
        />
      </div>
      <div className="mt-6 flex items-center justify-between gap-6">
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
