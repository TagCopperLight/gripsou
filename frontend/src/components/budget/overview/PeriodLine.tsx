import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";

import { RangeModal } from "./RangeModal";
import { useBudget } from "../budgetContext";
import { addMonths, currentMonth, monthLabel, periodLabel } from "../../../lib/period";

type PeriodLineProps = {
  /** The summary's own count — deliberately NOT the transactions list's number
   *  for the same month (handoff trap 7). The two differ; both are correct. */
  txnCount: number;
  /** Some row could not be valued, so the figures are understated. */
  fxMissing: boolean;
  /** False once the loaded period came back empty: the month on screen has
   *  nothing in it, so the one before it is presumed outside the data. The
   *  empty-period surface carries the escape hatch (addendum §2). */
  canStepBack: boolean;
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

export function PeriodLine({ txnCount, fxMissing, canStepBack }: PeriodLineProps) {
  const { t, i18n } = useTranslation();
  const { period, setPeriod } = useBudget();
  const [rangeOpen, setRangeOpen] = useState(false);

  const isRange = period.mode === "range";
  const step = (delta: number) => {
    if (period.mode !== "month") return;
    setPeriod({ mode: "month", month: addMonths(period.month, delta) });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {isRange ? (
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
            onClick={() => setPeriod({ mode: "month", month: currentMonth() })}
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
            onClick={() => step(-1)}
          />
          <span data-testid="period-label" className="min-w-40 text-center text-sm font-semibold text-fg">
            {monthLabel(period.month, i18n.language)}
          </span>
          <Caret
            dir="next"
            label={t("budget.overview.nextMonth")}
            // There is no future to analyse.
            disabled={period.month >= currentMonth()}
            onClick={() => step(1)}
          />
        </span>
      )}

      <button
        type="button"
        data-testid="period-range"
        onClick={() => setRangeOpen(true)}
        className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-140 ${
          isRange ? "bg-amber-soft text-amber" : "bg-surface text-fg-dim hover:text-fg"
        }`}
      >
        <CalendarRange className="size-4" />
        {t("budget.overview.range")}
      </button>

      <span data-testid="period-count" className="text-sm text-fg-faint">
        {t("budget.overview.transactionCount", { count: txnCount })}
      </span>

      {/* Same treatment the dashboard gives an unvalued holding: the figures on
          this page are understated, and the tooltip says why. */}
      {fxMissing && (
        <span
          data-testid="period-fx-missing"
          title={t("dashboard.fxMissing")}
          aria-label={t("dashboard.fxMissing")}
          className="text-sm text-fg-faint"
        >
          ⚠
        </span>
      )}

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
