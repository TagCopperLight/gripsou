import { useTranslation } from "react-i18next";

import { Comparison } from "./Comparison";
import { Surface } from "../../Surface";
import { PrivateMoney } from "../../PrivateMoney";
import type { BudgetSummary, Figure } from "../../../api/overview";

type FigureKey = "income" | "expenses" | "net";

/** Colour and comparison behaviour per figure. `format` is fixed
 *  per figure rather than per value: net can be zero or negative,
 *  where a percentage change is unstable, so they always read as an amount. */
const SPEC: Record<FigureKey, { tone: string; format: "percent" | "absolute"; goodWhen: "up" | "down" }> = {
  income: { tone: "text-green", format: "percent", goodWhen: "up" },
  expenses: { tone: "text-red", format: "percent", goodWhen: "down" },
  net: { tone: "text-fg", format: "absolute", goodWhen: "up" },
};

const ORDER: FigureKey[] = ["income", "expenses", "net"];

function FigureCell({ name, figure }: { name: FigureKey; figure: Figure }) {
  const { t } = useTranslation();
  const spec = SPEC[name];
  return (
    // The separator is the cell's own left border, placed near the preceding
    // cell's content rather than centred in the gap: `pr-2`
    // (8px) closes up to the bar, `pl-4` (16px) opens up to the following
    // cell's text. There is no grid gap left to add to that — see the grid
    // below. The border only applies from `sm` up, where cells actually sit
    // side by side; stacked on a phone, a leading border would just be a
    // stray vertical bar above each cell. At `sm` the grid is 2 columns, so
    // only the SECOND cell of each row (even index) sits beside a
    // predecessor — `not-first` there would wrongly also bar the 3rd cell,
    // which is the first cell of its own row. At `lg` (3 columns) every
    // cell but the first sits beside one, so `not-first` is right there.
    <div
      data-testid={`figure-${name}`}
      className="flex min-w-0 flex-col gap-1 border-fg/10 pr-2 sm:even:border-l sm:even:pl-4 lg:not-first:border-l lg:not-first:pl-4"
    >
      <span className="truncate text-xs text-fg-faint">
        {t(`budget.overview.figures.${name}`)}
      </span>
      <PrivateMoney
        value={figure.amount}
        className={`text-2xl font-semibold tracking-tight ${spec.tone}`}
      />
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-xs">
        <Comparison
          testId={`cmp-${name}-prevMonth`}
          label={t("budget.overview.vsPrevMonth")}
          current={figure.amount}
          baseline={figure.prevMonth}
          format={spec.format}
          goodWhen={spec.goodWhen}
        />
        <Comparison
          testId={`cmp-${name}-avg12`}
          label={t("budget.overview.vsAvg12")}
          current={figure.amount}
          baseline={figure.avg12}
          format={spec.format}
          goodWhen={spec.goodWhen}
        />
      </div>
    </div>
  );
}

export function FiguresSurface({ summary }: { summary: BudgetSummary }) {
  return (
    <Surface className="w-full">
      {/* Three across from `lg` up; stacked on a phone, where three columns of
          money would each be two characters wide. No horizontal gap: the
          separator is the cell's own border + padding (see FigureCell), so a
          grid gap would only widen it back out. `gap-y-5` keeps the vertical
          breathing room between stacked cells on a phone. */}
      <div className="grid grid-cols-1 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((name) => (
          <FigureCell key={name} name={name} figure={summary.figures[name]} />
        ))}
      </div>
    </Surface>
  );
}
