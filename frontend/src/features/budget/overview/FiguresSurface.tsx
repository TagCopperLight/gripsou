import { useTranslation } from "react-i18next";

import { Comparison } from "./Comparison";
import { Surface } from "../../../ui/Surface";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { FxAsterisk, FxFootnote } from "../../../ui/FxNote";
import { Bone, Skeleton } from "../../../ui/Skeleton";
import { staleClass } from "../../../ui/stale";
import type { BudgetSummary, Figure } from "../../../api/wire";

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

// From `sm` up the separator is each cell's own left border, where cells sit
// side by side (stacked on a phone it would be a stray bar). At `sm` (two
// columns) only the second cell of a row has a neighbour on its left, so
// `not-first` would also bar the first cell of the second row; at `lg` (three
// columns) every cell but the first has one.
const CELL = "flex min-w-0 flex-col gap-1 border-fg/10 pr-2 sm:even:border-l sm:even:pl-4 lg:not-first:border-l lg:not-first:pl-4";

// Three across from `lg` up; stacked on a phone, where three columns of money
// would each be two characters wide. No column gap: the separator is each
// cell's own border and padding.
const GRID = "grid grid-cols-1 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-3";

/** A figure's name, then its amount and two comparisons as bones, each in the
 *  line box of the text it stands for. */
function FigureBones({ name }: { name: FigureKey }) {
  const { t } = useTranslation();
  return (
    <div className={CELL}>
      <span className="truncate text-xs text-fg-faint">{t(`budget.overview.figures.${name}`)}</span>
      <span className="flex h-8 items-center">
        <Bone className="h-6 w-36" />
      </span>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5">
        {[0, 1].map((i) => (
          <span key={i} className="contents">
            <span className="flex h-4 items-center"><Bone className="h-2.5 w-14" /></span>
            <span className="flex h-4 items-center"><Bone className="h-2.5 w-28" /></span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FigureCell({ name, figure, fxMissing, masked, stale }: {
  name: FigureKey;
  figure: Figure;
  fxMissing: boolean;
  masked: boolean;
  stale: boolean;
}) {
  const { t } = useTranslation();
  const spec = SPEC[name];
  return (
    <div data-testid={`figure-${name}`} className={CELL}>
      <span className="truncate text-xs text-fg-faint">
        {t(`budget.overview.figures.${name}`)}
      </span>
      <span className={`relative w-fit ${staleClass(stale)}`}>
        <MaskedMoney masked={masked} value={figure.amount} className={`text-2xl font-semibold tracking-tight ${spec.tone}`} />
        {fxMissing && <FxAsterisk size="md" />}
      </span>
      <div className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-xs ${staleClass(stale)}`}>
        <Comparison
          testId={`cmp-${name}-prevMonth`}
          label={t("budget.overview.vsPrevMonth")}
          current={figure.amount}
          baseline={figure.prevMonth}
          format={spec.format}
          goodWhen={spec.goodWhen}
          masked={masked}
        />
        <Comparison
          testId={`cmp-${name}-avg12`}
          label={t("budget.overview.vsAvg12")}
          current={figure.amount}
          baseline={figure.avg12}
          format={spec.format}
          goodWhen={spec.goodWhen}
          masked={masked}
        />
      </div>
    </div>
  );
}

/** `summary` is `undefined` while it loads. `masked`: private mode, the
 *  amounts hidden (the page's eye reveals them). `stale`: the summary is a
 *  previous period's, while this one's loads. */
export function FiguresSurface({ summary, masked = false, stale = false }: {
  summary: BudgetSummary | undefined;
  masked?: boolean;
  stale?: boolean;
}) {
  const { t } = useTranslation();
  if (summary === undefined) {
    return (
      <Surface className="w-full">
        <Skeleton className={GRID}>
          {ORDER.map((name) => <FigureBones key={name} name={name} />)}
        </Skeleton>
      </Surface>
    );
  }
  return (
    <Surface className="w-full">
      <div className={GRID}>
        {ORDER.map((name) => (
          <FigureCell key={name} name={name} figure={summary.figures[name]} fxMissing={summary.fxMissing} masked={masked} stale={stale} />
        ))}
      </div>
      {summary.fxMissing && <FxFootnote className="px-5 pb-4 -mt-1">{t("fx.budget")}</FxFootnote>}
    </Surface>
  );
}
