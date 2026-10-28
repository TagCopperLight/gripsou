import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

import { RangeModal } from "./RangeModal";
import { useBudget } from "../budgetContext";
import { monthLabel, periodLabel, type Period } from "../../../lib/period";
import { PrivacyEye } from "../../PrivateMoney";
import type { Privacy } from "../../../auth/usePrivacy";

type PeriodLineProps = {
  /** The period on screen: the one picked, or the default it resolved to. */
  period: Period;
  /** Private mode: the eye that reveals every amount of the overview. */
  privacy: Privacy;
  /** Forward stops at the latest month with data; back is always open. */
  canStepBack: boolean;
  canStepForward: boolean;
  /** Moves a month period by `delta` months. */
  onStep: (delta: number) => void;
  /** At the line's far end (the AI's running pill). */
  end?: ReactNode;
};

function Caret({
  dir, label, disabled, onClick,
}: {
  dir: "prev" | "next";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      data-testid={`period-${dir}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-lg p-1 text-fg-dim transition-colors duration-140 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-faint/40 disabled:hover:text-fg-faint/40"
    >
      <Icon className="size-5" />
    </button>
  );
}

export function PeriodLine({
  period, privacy, canStepBack, canStepForward, onStep, end,
}: PeriodLineProps) {
  const { t, i18n } = useTranslation();
  const { setPeriod } = useBudget();
  const [rangeOpen, setRangeOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {period.mode === "range" ? (
        <span className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
          <span className="text-xs text-fg-faint">{t("budget.overview.customRange")}</span>
          <span data-testid="period-label" className="font-mono text-sm text-fg">
            {periodLabel(period, i18n.language)}
          </span>
          <button
            type="button"
            data-testid="period-clear"
            aria-label={t("budget.overview.clearRange")}
            title={t("budget.overview.clearRange")}
            // Back to the default: the latest month with data.
            onClick={() => setPeriod(null)}
            className="cursor-pointer text-fg transition-opacity duration-140 hover:opacity-70"
          >
            <X className="size-4" />
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 rounded-xl bg-surface px-2 py-1.5">
          <Caret
            dir="prev"
            label={t("budget.overview.prevMonth")}
            disabled={!canStepBack}
            onClick={() => onStep(-1)}
          />
          <span data-testid="period-label" className="min-w-40 text-center text-sm font-semibold text-fg">
            {monthLabel(period.month, i18n.language)}
          </span>
          <Caret
            dir="next"
            label={t("budget.overview.nextMonth")}
            disabled={!canStepForward}
            onClick={() => onStep(1)}
          />
        </span>
      )}

      <button
        type="button"
        data-testid="period-range"
        onClick={() => setRangeOpen(true)}
        className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-140 ${
          period.mode === "range" ? "bg-amber-soft text-amber" : "bg-surface text-fg hover:opacity-80"
        }`}
      >
        <Calendar className="size-4" />
        {t("budget.overview.range")}
      </button>

      {privacy.enabled && <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />}
      {end}

      {rangeOpen && (
        <RangeModal
          onClose={() => setRangeOpen(false)}
          onApply={(range) => {
            setPeriod({ mode: "range", ...range });
            setRangeOpen(false);
          }}
        />
      )}
    </div>
  );
}
